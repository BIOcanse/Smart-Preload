use super::*;
use std::collections::BTreeMap;

pub(crate) fn record_link_behavior(
    graph: &mut Graph,
    source_page_url: String,
    target_url: String,
    target_hint: String,
    occurred_at: String,
) {
    let source_map = graph
        .link_behavior_store
        .entry(source_page_url)
        .or_default();
    let record = source_map
        .entry(target_url)
        .or_insert_with(|| LinkBehaviorRecord {
            self_count: 0,
            blank_count: 0,
            last_target_hint: "_self".to_string(),
            last_seen_at: None,
        });

    if target_hint == "_blank" {
        record.blank_count += 1;
        record.last_target_hint = "_blank".to_string();
    } else {
        record.self_count += 1;
        record.last_target_hint = "_self".to_string();
    }

    record.last_seen_at = Some(occurred_at);
}

pub(crate) fn upsert_page_keywords(graph: &mut Graph, page_keyword_entry: PageKeywordEntry) {
    graph
        .page_keyword_store
        .insert(page_keyword_entry.page_url.clone(), page_keyword_entry);
    graph.page_keyword_buckets = PageKeywordBuckets::default();

    let entries = graph
        .page_keyword_store
        .values()
        .cloned()
        .collect::<Vec<PageKeywordEntry>>();

    for entry in entries {
        register_page_keyword_entry(graph, &entry);
    }
}

pub(crate) fn record_foreground_page(graph: &mut Graph, foreground_page: ForegroundPageRecord) {
    graph
        .recent_foreground_pages
        .retain(|entry| entry.page_url != foreground_page.page_url);
    prepend_history_page_pool_entry(
        graph,
        &foreground_page.title,
        &foreground_page.page_url,
        &foreground_page.text_digest,
    );
    graph.recent_foreground_pages.insert(0, foreground_page);

    if graph.recent_foreground_pages.len() > MAX_RECENT_FOREGROUND_PAGES {
        graph
            .recent_foreground_pages
            .truncate(MAX_RECENT_FOREGROUND_PAGES);
    }
}

pub(crate) fn normalize_page_keyword_store(
    page_keyword_store: &mut BTreeMap<String, PageKeywordEntry>,
) {
    let entries = page_keyword_store
        .values()
        .cloned()
        .filter_map(normalize_page_keyword_entry)
        .collect::<Vec<PageKeywordEntry>>();

    page_keyword_store.clear();

    for entry in entries {
        page_keyword_store.insert(entry.page_url.clone(), entry);
    }
}

pub(crate) fn normalize_recent_foreground_pages(
    recent_foreground_pages: &mut Vec<ForegroundPageRecord>,
) {
    let mut entries = recent_foreground_pages
        .drain(..)
        .filter_map(normalize_foreground_page_record)
        .collect::<Vec<ForegroundPageRecord>>();

    entries.sort_by(|left, right| right.activated_at.cmp(&left.activated_at));
    entries.truncate(MAX_RECENT_FOREGROUND_PAGES);
    *recent_foreground_pages = entries;
}

pub(crate) fn normalize_history_page_pool(
    history_page_titles: &mut Vec<String>,
    history_page_urls: &mut Vec<String>,
    history_page_texts: &mut Vec<String>,
    recent_foreground_pages: &[ForegroundPageRecord],
) {
    let mut entries = Vec::new();
    let max_input_len = history_page_titles
        .len()
        .max(history_page_urls.len())
        .max(history_page_texts.len());

    for index in 0..max_input_len {
        let page_url = history_page_urls
            .get(index)
            .map(|url| url.trim().to_owned())
            .unwrap_or_default();

        if page_url.is_empty() {
            continue;
        }

        entries.push((
            history_page_titles.get(index).cloned().unwrap_or_default(),
            page_url,
            history_page_texts.get(index).cloned().unwrap_or_default(),
        ));
    }

    if entries.is_empty() {
        for entry in recent_foreground_pages
            .iter()
            .take(MAX_HISTORY_PAGE_POOL_SIZE)
        {
            if entry.page_url.is_empty() {
                continue;
            }

            entries.push((
                entry.title.clone(),
                entry.page_url.clone(),
                entry.text_digest.clone(),
            ));
        }
    }

    let mut deduped_entries = Vec::new();
    let mut seen = BTreeMap::new();

    for (title, page_url, text) in entries {
        if page_url.is_empty() || seen.insert(page_url.clone(), true).is_some() {
            continue;
        }

        deduped_entries.push((title, page_url, text));

        if deduped_entries.len() >= MAX_HISTORY_PAGE_POOL_SIZE {
            break;
        }
    }

    *history_page_titles = deduped_entries
        .iter()
        .map(|(title, _, _)| title.clone())
        .collect::<Vec<String>>();
    *history_page_urls = deduped_entries
        .iter()
        .map(|(_, page_url, _)| page_url.clone())
        .collect::<Vec<String>>();
    *history_page_texts = deduped_entries
        .iter()
        .map(|(_, _, text)| text.clone())
        .collect::<Vec<String>>();
}

fn normalize_page_url(raw_page_url: &str) -> String {
    raw_page_url.trim().to_owned()
}

pub(crate) fn normalize_link_behavior_store(
    link_behavior_store: &mut BTreeMap<String, BTreeMap<String, LinkBehaviorRecord>>,
) {
    let mut next_store = BTreeMap::new();

    for (source_page_url, target_map) in link_behavior_store.iter_mut() {
        let normalized_source_page_url = normalize_page_url(source_page_url);

        if normalized_source_page_url.is_empty() {
            continue;
        }

        let mut next_target_map = BTreeMap::new();

        for (target_url, behavior) in target_map.iter_mut() {
            let normalized_target_url = normalize_page_url(target_url);

            if normalized_target_url.is_empty() {
                continue;
            }

            behavior.last_target_hint = if behavior.last_target_hint == "_blank" {
                "_blank".to_string()
            } else {
                "_self".to_string()
            };

            next_target_map.insert(normalized_target_url, behavior.clone());
        }

        if !next_target_map.is_empty() {
            next_store.insert(normalized_source_page_url, next_target_map);
        }
    }

    *link_behavior_store = next_store;
}

fn normalize_page_keyword_entry(entry: PageKeywordEntry) -> Option<PageKeywordEntry> {
    let page_url = entry.page_url.trim().to_owned();

    if page_url.is_empty() {
        return None;
    }

    let keywords = entry
        .keywords
        .into_iter()
        .filter_map(normalize_weighted_keyword)
        .take(8)
        .collect::<Vec<WeightedKeyword>>();

    Some(PageKeywordEntry {
        page_url,
        site_node_id: entry.site_node_id,
        title: entry.title,
        keywords,
        page_type: entry
            .page_type
            .map(|page_type| page_type.trim().to_owned())
            .filter(|page_type| !page_type.is_empty()),
        generated_at: entry.generated_at,
        expires_at: entry.expires_at,
        model_id: entry.model_id,
        content_fingerprint: entry.content_fingerprint,
    })
}

fn normalize_weighted_keyword(keyword: WeightedKeyword) -> Option<WeightedKeyword> {
    let text = keyword.text.trim().to_lowercase();

    if text.is_empty() {
        return None;
    }

    Some(WeightedKeyword {
        text,
        score: keyword.score.clamp(0.0, 1.0),
    })
}

fn normalize_foreground_page_record(entry: ForegroundPageRecord) -> Option<ForegroundPageRecord> {
    let page_url = entry.page_url.trim().to_owned();

    if page_url.is_empty() {
        return None;
    }

    Some(ForegroundPageRecord {
        tab_id: entry.tab_id,
        window_id: entry.window_id,
        node_id: entry.node_id,
        page_url,
        title: entry.title,
        text_digest: entry.text_digest,
        content_fingerprint: entry.content_fingerprint,
        activated_at: entry.activated_at,
        left_foreground_at: entry.left_foreground_at,
        was_preloaded_before_foreground: entry.was_preloaded_before_foreground,
    })
}

pub(crate) fn register_page_keyword_entry(
    graph: &mut Graph,
    page_keyword_entry: &PageKeywordEntry,
) {
    for keyword in &page_keyword_entry.keywords {
        let keyword_key = keyword.text.trim().to_lowercase();

        if keyword_key.is_empty() {
            continue;
        }

        graph
            .page_keyword_buckets
            .by_keyword
            .entry(keyword_key)
            .or_default()
            .insert(
                page_keyword_entry.page_url.clone(),
                keyword.score.clamp(0.0, 1.0),
            );
    }
}

fn prepend_history_page_pool_entry(graph: &mut Graph, title: &str, page_url: &str, text: &str) {
    let normalized_page_url = page_url.trim();

    if normalized_page_url.is_empty() {
        return;
    }

    let mut entries = Vec::new();
    entries.push((
        title.to_owned(),
        normalized_page_url.to_owned(),
        text.to_owned(),
    ));

    let max_existing_len = graph
        .history_page_titles
        .len()
        .max(graph.history_page_urls.len())
        .max(graph.history_page_texts.len());

    for index in 0..max_existing_len {
        let existing_page_url = graph
            .history_page_urls
            .get(index)
            .map(|url| url.trim().to_owned())
            .unwrap_or_default();

        if existing_page_url.is_empty() || existing_page_url == normalized_page_url {
            continue;
        }

        entries.push((
            graph
                .history_page_titles
                .get(index)
                .cloned()
                .unwrap_or_default(),
            existing_page_url,
            graph
                .history_page_texts
                .get(index)
                .cloned()
                .unwrap_or_default(),
        ));

        if entries.len() >= MAX_HISTORY_PAGE_POOL_SIZE {
            break;
        }
    }

    graph.history_page_titles = entries
        .iter()
        .map(|(entry_title, _, _)| entry_title.clone())
        .collect::<Vec<String>>();
    graph.history_page_urls = entries
        .iter()
        .map(|(_, entry_page_url, _)| entry_page_url.clone())
        .collect::<Vec<String>>();
    graph.history_page_texts = entries
        .iter()
        .map(|(_, _, entry_text)| entry_text.clone())
        .collect::<Vec<String>>();
}

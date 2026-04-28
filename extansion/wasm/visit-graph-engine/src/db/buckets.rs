use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

mod pages;
mod transitions;

pub(crate) use pages::*;
pub(crate) use transitions::*;

pub(crate) fn create_empty_bucket_layer() -> Vec<BTreeMap<String, BTreeMap<String, u64>>> {
    vec![BTreeMap::new(); OUTBOUND_BUCKET_COUNT]
}

pub(crate) fn create_empty_message_bucket_layer()
-> Vec<BTreeMap<String, BTreeMap<String, Vec<u64>>>> {
    vec![BTreeMap::new(); OUTBOUND_BUCKET_COUNT]
}

pub(crate) fn create_empty_page_bucket_layer() -> Vec<PageTransitionBucket> {
    vec![BTreeMap::new(); OUTBOUND_BUCKET_COUNT]
}

pub(crate) fn create_empty_page_message_bucket_layer() -> Vec<PageTransitionMessageBucket> {
    vec![BTreeMap::new(); OUTBOUND_BUCKET_COUNT]
}

pub(crate) fn source_bucket_index(graph: &Graph, source_node_id: &str) -> usize {
    let bucket_text = node_bucket_label(graph, source_node_id);
    let mut characters = bucket_text.chars();
    let first_index = bucket_char_index(characters.next());
    let second_index = match characters.next() {
        Some(character) => bucket_char_index(Some(character)),
        None => BUCKET_SECONDARY_BLANK_INDEX,
    };

    first_index * (BUCKET_PRIMARY_CHARSET.len() + 1) + second_index
}

pub(crate) fn current_day_key() -> String {
    let system_now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() / 86_400)
        .unwrap_or(0);

    civil_from_days(system_now as i64)
}

pub(crate) fn transition_bucket_day_layer_mut<'a>(
    graph: &'a mut Graph,
    day_key: &str,
) -> &'a mut Vec<BTreeMap<String, BTreeMap<String, u64>>> {
    graph
        .transition_buckets
        .by_day
        .entry(day_key.to_owned())
        .or_insert_with(create_empty_bucket_layer)
}

pub(crate) fn matching_day_keys_for_window(graph: &Graph, window_key: &str) -> Vec<String> {
    if window_key == "total" {
        return graph.transition_buckets.by_day.keys().cloned().collect();
    }

    let Some(max_age_days) = transition_window_max_age_days(window_key) else {
        return Vec::new();
    };
    let Some(reference_day) = day_key_to_epoch_day(&current_day_key()) else {
        return Vec::new();
    };

    graph
        .transition_buckets
        .by_day
        .keys()
        .filter_map(|day_key| {
            let day_number = day_key_to_epoch_day(day_key)?;
            let age_in_days = reference_day.saturating_sub(day_number);

            if age_in_days <= max_age_days {
                Some(day_key.clone())
            } else {
                None
            }
        })
        .collect()
}

fn transition_window_max_age_days(window_key: &str) -> Option<u64> {
    match window_key {
        "last365d" => Some(364),
        "last30d" => Some(29),
        "last7d" => Some(6),
        "last1d" => Some(0),
        _ => None,
    }
}

pub(crate) fn node_host(graph: &Graph, node_id: &str) -> String {
    graph
        .nodes
        .get(node_id)
        .map(|node| node.host.clone())
        .unwrap_or_else(|| node_id.to_owned())
}

fn node_bucket_label(graph: &Graph, node_id: &str) -> String {
    let raw_text = graph
        .nodes
        .get(node_id)
        .map(|node| {
            if !node.hostname.is_empty() {
                node.hostname.clone()
            } else if !node.host.is_empty() {
                node.host.clone()
            } else {
                node_id.to_owned()
            }
        })
        .unwrap_or_else(|| node_id.to_owned())
        .to_lowercase();

    raw_text
        .strip_prefix("www.")
        .unwrap_or(&raw_text)
        .to_owned()
}

fn bucket_char_index(character: Option<char>) -> usize {
    let normalized = normalize_bucket_char(character);
    BUCKET_PRIMARY_CHARSET
        .chars()
        .position(|candidate| candidate == normalized)
        .unwrap_or(BUCKET_PRIMARY_CHARSET.len() - 1)
}

fn normalize_bucket_char(character: Option<char>) -> char {
    let lowered = character.unwrap_or('_').to_ascii_lowercase();

    if BUCKET_PRIMARY_CHARSET.contains(lowered) {
        lowered
    } else {
        '_'
    }
}

pub(crate) fn build_day_key(timestamp: &str) -> String {
    if timestamp.len() >= 10 {
        let candidate = &timestamp[..10];
        if is_valid_day_key(candidate) {
            return candidate.to_owned();
        }
    }

    "1970-01-01".to_owned()
}

fn is_valid_day_key(value: &str) -> bool {
    value.len() == 10
        && value
            .chars()
            .enumerate()
            .all(|(index, character)| match index {
                4 | 7 => character == '-',
                _ => character.is_ascii_digit(),
            })
}

pub(crate) fn day_key_to_epoch_day(day_key: &str) -> Option<u64> {
    if !is_valid_day_key(day_key) {
        return None;
    }

    let year = day_key[0..4].parse::<i64>().ok()?;
    let month = day_key[5..7].parse::<u32>().ok()?;
    let day = day_key[8..10].parse::<u32>().ok()?;
    Some(days_from_civil(year, month, day) as u64)
}

fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let adjusted_year = year - i64::from(month <= 2);
    let era = if adjusted_year >= 0 {
        adjusted_year / 400
    } else {
        (adjusted_year - 399) / 400
    };
    let year_of_era = adjusted_year - era * 400;
    let month_index = i64::from(month);
    let day_of_year =
        (153 * (month_index + if month > 2 { -3 } else { 9 }) + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;

    era * 146_097 + day_of_era - 719_468
}

fn civil_from_days(days: i64) -> String {
    let shifted_days = days + 719_468;
    let era = if shifted_days >= 0 {
        shifted_days / 146_097
    } else {
        (shifted_days - 146_096) / 146_097
    };
    let day_of_era = shifted_days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    let year = year + i64::from(month <= 2);

    format!("{year:04}-{month:02}-{day:02}")
}

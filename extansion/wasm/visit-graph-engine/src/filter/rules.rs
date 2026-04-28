use super::model::FilterRuleCardStateInput;

pub(super) fn is_rule_card_enabled(rule_card_state: &FilterRuleCardStateInput) -> bool {
    normalize_status(&rule_card_state.status) == "enabled"
}

pub(super) fn evaluate_rule_card_metric(
    rule_card_state: &FilterRuleCardStateInput,
    metric_value: f64,
) -> bool {
    if !is_rule_card_enabled(rule_card_state) {
        return true;
    }

    let left_passed = if normalize_operator(&rule_card_state.operator_a) == "disabled" {
        true
    } else {
        compare_rule_values(
            rule_card_state.value_a,
            &rule_card_state.operator_a,
            metric_value,
        )
    };
    let right_passed = if normalize_operator(&rule_card_state.operator_b) == "disabled" {
        true
    } else {
        compare_rule_values(
            metric_value,
            &rule_card_state.operator_b,
            rule_card_state.value_c,
        )
    };

    left_passed && right_passed
}

fn compare_rule_values(left_value: f64, operator: &str, right_value: f64) -> bool {
    match normalize_operator(operator) {
        "gt" => left_value > right_value,
        "gte" => left_value >= right_value,
        "eq" => (left_value - right_value).abs() <= f64::EPSILON,
        "lte" => left_value <= right_value,
        "lt" => left_value < right_value,
        _ => true,
    }
}

fn normalize_operator(value: &str) -> &str {
    match value {
        "gt" | "gte" | "eq" | "lte" | "lt" => value,
        _ => "disabled",
    }
}

fn normalize_status(value: &str) -> &str {
    match value {
        "enabled" => "enabled",
        _ => "disabled",
    }
}

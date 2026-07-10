use serde::{Deserialize, Serialize};

const NORMALIZATION_MULTIPLIER_SCALE: f64 = 0.7;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoringBreakdown {
    pub base_score: f64,
    pub combined_score: f64,
    pub normalized_score: f64,
    pub effective_multiplier_count: usize,
    pub multipliers: Vec<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreWeightsInput {
    pub base_score: f64,
    #[serde(default)]
    pub multipliers: Vec<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreWeightsBatchInput {
    #[serde(default)]
    pub inputs: Vec<ScoreWeightsInput>,
}

pub fn count_effective_multipliers(multipliers: &[f64]) -> usize {
    multipliers
        .iter()
        .copied()
        .filter(|multiplier| multiplier.is_finite())
        .filter(|multiplier| (*multiplier - 1.0).abs() > f64::EPSILON)
        .count()
}

pub fn apply_nth_root_weight_normalization(base_score: f64, multipliers: &[f64]) -> f64 {
    let breakdown = build_scoring_breakdown(base_score, multipliers);
    breakdown.normalized_score
}

pub fn build_scoring_breakdown(base_score: f64, multipliers: &[f64]) -> ScoringBreakdown {
    let sanitized_base_score = sanitize_weight(base_score, 0.0);
    let sanitized_multipliers = multipliers
        .iter()
        .copied()
        .filter(|multiplier| multiplier.is_finite())
        .map(|multiplier| sanitize_weight(multiplier, 1.0))
        .collect::<Vec<f64>>();
    let effective_multiplier_count = count_effective_multipliers(&sanitized_multipliers);
    let combined_score = sanitized_multipliers
        .iter()
        .fold(sanitized_base_score, |score, multiplier| score * multiplier);
    let normalized_score = if effective_multiplier_count == 0 || combined_score <= 0.0 {
        combined_score
    } else {
        combined_score
            .powf(1.0 / (NORMALIZATION_MULTIPLIER_SCALE * effective_multiplier_count as f64))
    };

    ScoringBreakdown {
        base_score: sanitized_base_score,
        combined_score,
        normalized_score,
        effective_multiplier_count,
        multipliers: sanitized_multipliers,
    }
}

pub fn score_weights(input: ScoreWeightsInput) -> ScoringBreakdown {
    build_scoring_breakdown(input.base_score, &input.multipliers)
}

pub fn score_weights_batch(input: ScoreWeightsBatchInput) -> Vec<ScoringBreakdown> {
    input.inputs.into_iter().map(score_weights).collect()
}

fn sanitize_weight(value: f64, fallback: f64) -> f64 {
    if !value.is_finite() {
        return fallback;
    }

    value.max(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scoring_sanitizes_invalid_and_negative_weights() {
        let breakdown = build_scoring_breakdown(-5.0, &[2.0, -3.0, f64::NAN]);

        assert_eq!(breakdown.base_score, 0.0);
        assert_eq!(breakdown.multipliers, vec![2.0, 0.0]);
        assert_eq!(breakdown.combined_score, 0.0);
        assert_eq!(breakdown.normalized_score, 0.0);
        assert_eq!(breakdown.effective_multiplier_count, 2);
    }

    #[test]
    fn neutral_multipliers_do_not_change_the_base_score() {
        let breakdown = build_scoring_breakdown(9.0, &[1.0, 1.0]);

        assert_eq!(breakdown.combined_score, 9.0);
        assert_eq!(breakdown.normalized_score, 9.0);
        assert_eq!(breakdown.effective_multiplier_count, 0);
    }

    #[test]
    fn batch_scoring_preserves_input_order() {
        let results = score_weights_batch(ScoreWeightsBatchInput {
            inputs: vec![
                ScoreWeightsInput {
                    base_score: 4.0,
                    multipliers: vec![1.0],
                },
                ScoreWeightsInput {
                    base_score: 8.0,
                    multipliers: vec![0.5],
                },
            ],
        });

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].base_score, 4.0);
        assert_eq!(results[1].base_score, 8.0);
        assert_eq!(results[1].combined_score, 4.0);
    }
}

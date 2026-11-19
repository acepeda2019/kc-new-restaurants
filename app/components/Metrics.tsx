import type { Metrics as MetricsData } from "@/lib/data";

type Props = {
  metrics: Pick<
    MetricsData,
    "opened_last_30_days" | "opened_prior_30_days" | "opened_last_7_days" | "clean_first_inspection_count"
  >;
};

/** Headline numbers from mart_metrics. */
export function Metrics({ metrics }: Props) {
  return (
    <dl className="metrics">
      <div>
        <dt>Opened in the last 30 days</dt>
        <dd className="number">{metrics.opened_last_30_days}</dd>
        <dd className="note">{metrics.opened_prior_30_days} in the 30 days before</dd>
      </div>
      <div>
        <dt>Opened in the last 7 days</dt>
        <dd className="number">{metrics.opened_last_7_days}</dd>
      </div>
      <div>
        <dt>Clean first inspections (last 180 days)</dt>
        <dd className="number">{metrics.clean_first_inspection_count}</dd>
        <dd className="note">Scored with zero red points</dd>
      </div>
    </dl>
  );
}

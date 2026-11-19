import type { Metrics as MetricsData } from "@/lib/data";

type Props = {
  metrics: Pick<
    MetricsData,
    "opened_last_30_days" | "opened_prior_30_days" | "opened_last_7_days" | "opened_last_180_days" | "clean_first_inspection_count"
  >;
};

/** Headline numbers from mart_metrics. */
export function Metrics({ metrics }: Props) {
  return (
    <dl className="metrics">
      <div>
        <dt>Opened in the last 30 days</dt>
        <dd>
          {metrics.opened_last_30_days}
          <small>{metrics.opened_prior_30_days} in the 30 days before</small>
        </dd>
      </div>
      <div>
        <dt>Opened in the last 7 days</dt>
        <dd>{metrics.opened_last_7_days}</dd>
      </div>
      <div>
        <dt>Clean first inspections</dt>
        <dd>
          {metrics.clean_first_inspection_count}
          <small>of {metrics.opened_last_180_days} openings in 180 days</small>
        </dd>
      </div>
    </dl>
  );
}

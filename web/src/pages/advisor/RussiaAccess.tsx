import type { Recommendation } from "../../api/types";
import { Badge } from "../../components/ui/Badge";
import { formatDate } from "../../lib/format";

type Profile = NonNullable<Recommendation["profile"]>;

export function RussiaAccess({
  profile,
  direct = false,
}: {
  profile?: Profile | null;
  direct?: boolean;
}) {
  const status =
    profile?.russia_api_status ?? (direct ? "available" : "unverified");
  return (
    <Badge tone={status === "available" ? "success" : "warning"}>
      {status === "available"
        ? "В России: да"
        : status === "unavailable"
          ? "В России: нет"
          : "В России: не подтверждено"}
    </Badge>
  );
}

export function ModelFacts({ profile }: { profile: Profile }) {
  return (
    <details className="model-facts">
      <summary>Задачи, ограничения и доступ в России</summary>
      <p>{profile.russia_api_note ?? profile.access_note}</p>
      {profile.access_url ? (
        <p>
          <a href={profile.access_url} target="_blank" rel="noreferrer">
            Официальный источник о доступе ↗
          </a>{" "}
          · сверено {formatDate(profile.access_reviewed_at)}
        </p>
      ) : null}
      <p>
        Выход: до {profile.max_output_tokens.toLocaleString("ru-RU")} токенов.{" "}
        {profile.version_note}
      </p>
      {profile.best_for?.length ? (
        <>
          <h4>Примерные сценарии применения</h4>
          <ul>
            {profile.best_for.map((task) => (
              <li key={task}>{task}</li>
            ))}
          </ul>
          <p className="muted small">
            Сценарии — экспертная рекомендация, перед внедрением нужен пилот.
          </p>
        </>
      ) : null}
      <ul>
        {profile.conditions.map((condition) => (
          <li key={condition}>{condition}</li>
        ))}
      </ul>
    </details>
  );
}

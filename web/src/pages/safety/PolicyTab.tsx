import { getPolicy } from "../../api/client";
import type { Action, Policy } from "../../api/types";
import { Badge } from "../../components/ui/Badge";
import { Banner, ErrorBanner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { LoadingRegion, SkeletonLines } from "../../components/ui/Skeleton";
import { useAsync } from "../../hooks/useAsync";
import { downloadTextFile } from "../../lib/download";
import { formatDate } from "../../lib/format";
import { ACTION_STYLE } from "./DecisionCards";

function Matrix({ policy }: { policy: Policy }) {
  const actionLabel = (action: Action) => policy.actions.find((item) => item.value === action)?.label ?? action;
  return (
    <div className="table-wrap">
      <table className="table matrix" data-testid="policy-matrix">
        <caption className="visually-hidden">Матрица: какие данные в какой контур можно отправлять</caption>
        <thead>
          <tr>
            <th scope="col">Категория данных</th>
            {policy.deployments.filter((deployment) => deployment.value !== "self_hosted").map((deployment) => (
              <th key={deployment.value} scope="col" title={deployment.description ?? undefined}>
                {deployment.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {policy.classes.map((sensitivity) => (
            <tr key={sensitivity.value}>
              <th scope="row">
                {sensitivity.label}
                <span className="muted small matrix__desc">{sensitivity.description}</span>
              </th>
              {policy.deployments.filter((deployment) => deployment.value !== "self_hosted").map((deployment) => {
                const action = policy.matrix[sensitivity.value]?.[deployment.value];
                return (
                  <td key={deployment.value}>
                    {action ? (
                      <Badge tone={ACTION_STYLE[action].tone} icon={ACTION_STYLE[action].icon}>
                        {actionLabel(action)}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PolicyTab() {
  const policy = useAsync((signal) => getPolicy(signal), "policy");

  if (policy.error) return <ErrorBanner error={policy.error} onRetry={policy.reload} title="Не удалось загрузить политику" />;
  if (!policy.data) {
    return (
      <LoadingRegion label="Загружаем политику…">
        <SkeletonLines lines={6} />
      </LoadingRegion>
    );
  }
  const data = policy.data;

  return (
    <div className="stack">
      <Banner tone="info" title={`Политика обновлена ${formatDate(data.updated)}`}>
        {data.disclaimer}
      </Banner>

      <section className="card" aria-labelledby="matrix-title">
        <header className="card__header">
          <h2 id="matrix-title" className="card__title">
            Что куда можно отправлять
          </h2>
          <Button
            icon="download"
            size="sm"
            onClick={() => downloadTextFile("pamyatka-bezopasnaya-rabota-s-ii.md", data.handout_markdown)}
          >
            Скачать памятку (.md)
          </Button>
        </header>
        <Matrix policy={data} />
      </section>

      <Banner tone="danger" title="Секреты не отправляют никуда">
        {data.secrets_message}
      </Banner>

      <div className="do-dont">
        <section className="card" aria-labelledby="do-title">
          <h2 id="do-title" className="card__title card__title--good">
            <Icon name="check-circle" size={18} /> Что делать
          </h2>
          <ul className="rules rules--do">
            {data.do.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <section className="card" aria-labelledby="dont-title">
          <h2 id="dont-title" className="card__title card__title--bad">
            <Icon name="x-circle" size={18} /> Чего не делать
          </h2>
          <ul className="rules rules--dont">
            {data.dont.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

import type { Invoice, Operation, ProMode } from '../../types';
import type { Alert, Forecast } from '../../lib/forecast';
import { PRO_CATEGORIES } from '../../data/categories';
import { formatEuros } from '../../lib/money';
import { formatMonthTitle, parisYMD } from '../../lib/dates';
import { opsOfMonth, totals } from '../../lib/stats';
import { Hero } from '../../components/Hero';
import { DemoBar } from '../../components/DemoBar';
import { OperationList } from '../../components/OperationList';
import { Icon } from '../../components/Icon';
import { AlertsCard, ForecastCard, UpcomingCard } from '../../components/ForecastCard';
import { todayKey } from '../../lib/forecast';
import { InvoiceRow } from './Invoices';

interface Props {
  ops: Operation[];
  invoices: Invoice[];
  mode: ProMode;
  /** Solde actuel (centimes) : solde de départ + opérations depuis ce jour. */
  balanceCents: number;
  /** Fournis seulement en démonstration. */
  onDemo?: (kind: 'depense' | 'recette') => void;
  onEditOpening?: () => void;
  onSeeInvoices: () => void;
  onSeeFlows: () => void;
  alerts: Alert[];
  forecast: Forecast;
  /** Supprime une opération prévue. */
  onRemovePlanned?: (id: string) => void;
}

export function ProHome({ ops, invoices, mode, balanceCents, onDemo, onEditOpening, onSeeInvoices, onSeeFlows, alerts, forecast, onRemovePlanned }: Props) {
  const t = parisYMD(new Date());
  const { income, expense } = totals(opsOfMonth(ops, t.y, t.m));
  const balance = balanceCents;
  const upcoming = invoices.filter((i) => i.status === 'en_attente').sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 3);

  return (
    <>
      <Hero
        label="Solde de trésorerie"
        cents={balance}
        sub={`Ce mois-ci : ${formatMonthTitle(t.y, t.m)}`}
        action={
          onEditOpening && (
            <button className="hero-link" onClick={onEditOpening}>
              Modifier le solde de départ
            </button>
          )
        }
      >
        <div className="hero-tiles">
          <div>
            <small>Encaissements</small>
            <b className="pos-light">+{formatEuros(income)}</b>
          </div>
          <div>
            <small>Décaissements</small>
            <b className="neg-light">−{formatEuros(expense)}</b>
          </div>
        </div>
      </Hero>

      {onDemo && <DemoBar onAdd={onDemo} />}

      <AlertsCard alerts={alerts} />

      <UpcomingCard events={forecast.events} today={todayKey()} onRemovePlanned={onRemovePlanned} />

      <ForecastCard forecast={forecast} professional />

      <section className="card">
        <div className="card-head">
          <h3>Échéances à venir</h3>
          <button className="link" onClick={onSeeInvoices}>
            Tout voir
          </button>
        </div>
        {upcoming.length === 0 ? (
          <p className="empty">Aucune échéance enregistrée.</p>
        ) : (
          <ul className="ops">
            {upcoming.map((i) => (
              <InvoiceRow key={i.id} inv={i} />
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Dernières opérations</h3>
          <button className="link" onClick={onSeeFlows}>
            Tout voir
          </button>
        </div>
        <OperationList ops={ops} categories={PRO_CATEGORIES} limit={5} showAuthor={mode === 'equipe'} />
      </section>

      <MatrixCard />
    </>
  );
}

/** Point d'entrée prévu pour la liaison avec la matrice Excel (étape 6). */
export function MatrixCard() {
  return (
    <section className="card matrix">
      <span className="op-icon">
        <Icon name="table" size={19} />
      </span>
      <div>
        <h3>Matrice Excel</h3>
        <p className="muted small">Reliez votre tableau de pilotage pour calculer vos prévisions. Disponible plus tard.</p>
      </div>
      <button className="btn btn-ghost" disabled>
        Bientôt
      </button>
    </section>
  );
}

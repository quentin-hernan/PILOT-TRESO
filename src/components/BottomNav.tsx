import { Icon, type IconName } from './Icon';

export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
}

interface Props {
  items: NavItem[];
  active: string;
  onSelect: (id: string) => void;
  onMic: () => void;
}

/** Barre de navigation du bas, avec le gros bouton micro toujours visible au centre. */
export function BottomNav({ items, active, onSelect, onMic }: Props) {
  const half = Math.ceil(items.length / 2);
  const left = items.slice(0, half);
  const right = items.slice(half);

  const renderItem = (it: NavItem) => (
    <button key={it.id} className={`nav-item ${active === it.id ? 'on' : ''}`} onClick={() => onSelect(it.id)}>
      <Icon name={it.icon} />
      <span>{it.label}</span>
    </button>
  );

  return (
    <nav className="nav" aria-label="Navigation principale">
      <div className="nav-side">{left.map(renderItem)}</div>
      <div className="nav-mic-slot">
        <button className="mic" onClick={onMic} aria-label="Dicter une opération">
          <Icon name="mic" size={26} />
        </button>
      </div>
      <div className="nav-side">{right.map(renderItem)}</div>
    </nav>
  );
}

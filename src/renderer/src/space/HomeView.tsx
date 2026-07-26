import { useState } from 'react';
import type { SpaceLink } from '@shared/types';
import type { SectionDto, SuggestionDto } from '@shared/space-types';
import { invoke } from '../ipc';
import { ContextMenu } from '../components/ContextMenu';
import { LinkDialog } from './LinkDialog';
import { SwitcherFlyout } from './SwitcherFlyout';
import { CloseIcon, GridIcon, PlusIcon } from '../components/Icons';
import { SuggestInput } from './SuggestInput';

type Dialog = { kind: 'add' } | { kind: 'edit'; link: SpaceLink } | null;

/**
 * A launcher-style page, no browser chrome: search/URL box near the top and
 * the link grid below, like a mobile app launcher (docs/ui.md → Home view).
 */
export function HomeView({
  spaceId,
  section,
  links
}: {
  spaceId: string;
  section: SectionDto;
  links: SpaceLink[];
}): React.JSX.Element {
  const side = section.side;
  const [menu, setMenu] = useState<{ x: number; y: number; link: SpaceLink } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const orderedLinks = dragOrder
    ? (dragOrder.map((id) => links.find((l) => l.id === id)).filter(Boolean) as SpaceLink[])
    : links;

  const submit = (text: string, suggestion: SuggestionDto | null): void => {
    if (suggestion?.linkId) {
      void invoke('section:openLink', spaceId, side, suggestion.linkId);
    } else {
      void invoke('section:submitInput', spaceId, side, suggestion?.url ?? text);
    }
  };

  const commitReorder = (): void => {
    if (dragOrder) void invoke('links:reorder', spaceId, dragOrder);
    setDragOrder(null);
    setDragId(null);
  };

  return (
    <div className="home-view">
      {section.showReturnButton && (
        <button
          className="icon-button home-return"
          title={section.returnCloses ? 'Close view' : 'Back to page'}
          onClick={() => void invoke('section:returnFromHome', spaceId, side)}
        >
          <CloseIcon />
        </button>
      )}

      <div className="home-search">
        <SuggestInput
          spaceId={spaceId}
          side={side}
          includeTrail={false}
          placeholder="Search or enter address"
          clearOnSubmit
          onSubmit={submit}
        />
      </div>

      <div className="home-grid">
        {orderedLinks.map((link) => (
          <button
            key={link.id}
            className={`home-tile${dragId === link.id ? ' dragging' : ''}`}
            draggable
            onClick={() => void invoke('section:openLink', spaceId, side, link.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, link });
            }}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              setDragId(link.id);
              setDragOrder(links.map((l) => l.id));
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (!dragId || dragId === link.id || !dragOrder) return;
              const next = dragOrder.filter((id) => id !== dragId);
              next.splice(next.indexOf(link.id) < 0 ? next.length : next.indexOf(link.id), 0, dragId);
              if (next.join() !== dragOrder.join()) setDragOrder(next);
            }}
            onDragEnd={commitReorder}
          >
            <span className="home-tile-icon">
              {link.icon ? (
                <img src={`flank-icon://data/${link.icon.replace(/\\/g, '/')}`} alt="" draggable={false} />
              ) : (
                <span className="home-tile-letter">{initialOf(link.title)}</span>
              )}
            </span>
            <span className="home-tile-title">{link.title}</span>
          </button>
        ))}

      </div>

      <button className="button home-add" onClick={() => setDialog({ kind: 'add' })}>
        <PlusIcon />
        Add link
      </button>

      {side === 'left' && (
        <button
          className="icon-button home-switcher"
          title="Spaces"
          onClick={() => setSwitcherOpen(true)}
        >
          <GridIcon />
        </button>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            { label: 'Edit', onClick: () => setDialog({ kind: 'edit', link: menu.link }) },
            {
              label: 'Remove',
              danger: true,
              onClick: () => void invoke('links:remove', spaceId, menu.link.id)
            }
          ]}
          onClose={() => setMenu(null)}
        />
      )}

      {dialog?.kind === 'add' && (
        <LinkDialog
          title="Add link"
          initialTitle=""
          initialUrl=""
          onSubmit={(title, url) => {
            setDialog(null);
            void invoke('links:add', spaceId, { title, url });
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'edit' && (
        <LinkDialog
          title="Edit link"
          initialTitle={dialog.link.title}
          initialUrl={dialog.link.url}
          onSubmit={(title, url) => {
            setDialog(null);
            void invoke('links:update', spaceId, dialog.link.id, { title, url });
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {switcherOpen && <SwitcherFlyout spaceId={spaceId} onClose={() => setSwitcherOpen(false)} />}
    </div>
  );
}

function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed.length === 0 ? '?' : trimmed[0].toUpperCase();
}

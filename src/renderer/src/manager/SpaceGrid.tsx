import { useState } from 'react';
import type { SpaceSummary } from '@shared/ipc-types';
import { invoke } from '../ipc';
import { ContextMenu, MenuItem } from '../components/ContextMenu';
import { NamePrompt, Confirm } from '../components/Modal';

type Dialog =
  | { kind: 'new' }
  | { kind: 'rename'; space: SpaceSummary }
  | { kind: 'delete'; space: SpaceSummary }
  | null;

/** The Manager's main view: one 132x132 tile per space plus a trailing "New space" tile. */
export function SpaceGrid({
  spaces,
  onChanged
}: {
  spaces: SpaceSummary[];
  onChanged: () => void;
}): React.JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number; space: SpaceSummary } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const openSpace = (id: string): void => {
    void invoke('spaces:open', id).then(onChanged);
  };

  const menuItems = (space: SpaceSummary, index: number): MenuItem[] => [
    { label: 'Open', onClick: () => openSpace(space.id) },
    { label: 'Rename', onClick: () => setDialog({ kind: 'rename', space }) },
    { label: 'Delete', danger: true, onClick: () => setDialog({ kind: 'delete', space }) },
    {
      label: 'Move up',
      disabled: index === 0,
      onClick: () => void invoke('spaces:move', space.id, -1).then(onChanged)
    },
    {
      label: 'Move down',
      disabled: index === spaces.length - 1,
      onClick: () => void invoke('spaces:move', space.id, 1).then(onChanged)
    }
  ];

  return (
    <div className="space-grid">
      {spaces.map((space, index) => (
        <button
          key={space.id}
          className="space-tile"
          onClick={() => openSpace(space.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, space });
          }}
        >
          <div className="space-tile-art">
            {space.icons.length > 0 ? (
              <div className={`tile-montage count-${Math.min(space.icons.length, 4)}`}>
                {space.icons.slice(0, 4).map((src, i) => (
                  <img key={i} src={src} alt="" draggable={false} />
                ))}
              </div>
            ) : (
              <span className="tile-initial">{initialOf(space.name)}</span>
            )}
            {space.open && <span className="tile-open-dot" title="Open" />}
          </div>
          <span className="space-tile-name">{space.name}</span>
        </button>
      ))}

      <button className="space-tile space-tile-new" onClick={() => setDialog({ kind: 'new' })}>
        <div className="space-tile-art">
          <span className="tile-plus">＋</span>
        </div>
        <span className="space-tile-name">New space</span>
      </button>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(
            menu.space,
            spaces.findIndex((s) => s.id === menu.space.id)
          )}
          onClose={() => setMenu(null)}
        />
      )}

      {dialog?.kind === 'new' && (
        <NamePrompt
          title="New space"
          initial=""
          submitLabel="Create"
          onSubmit={(name) => {
            setDialog(null);
            void invoke('spaces:create', name).then(onChanged);
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <NamePrompt
          title="Rename space"
          initial={dialog.space.name}
          submitLabel="Rename"
          onSubmit={(name) => {
            setDialog(null);
            void invoke('spaces:rename', dialog.space.id, name).then(onChanged);
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'delete' && (
        <Confirm
          title="Delete space"
          message={`Delete "${dialog.space.name}"? Its pinned links and session are removed. Browsing data (cookies, logins) is shared and stays.`}
          confirmLabel="Delete"
          onConfirm={() => {
            setDialog(null);
            void invoke('spaces:delete', dialog.space.id).then(onChanged);
          }}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed.length === 0 ? '?' : trimmed[0].toUpperCase();
}

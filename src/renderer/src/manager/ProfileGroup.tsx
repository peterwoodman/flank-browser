import { useState } from 'react';
import type { ProfileSummary, SpaceSummary } from '@shared/ipc-types';
import { washVars } from '../wash';
import { ContextMenu, MenuItem } from '../components/ContextMenu';

/** The space being dragged, and the profile the pointer is currently over. */
export interface SpaceDrag {
  space: SpaceSummary;
  over: string;
}

/**
 * One profile's spaces: a rule separating it from the profile above, its name,
 * and a row of tiles ending in "New space" — plus "Remove profile" while it
 * holds no spaces. A tile dragged in from another profile is copied here.
 */
export function ProfileGroup({
  profile,
  divided,
  named,
  removable,
  drag,
  onOpen,
  onEdit,
  onDelete,
  onMove,
  onNewSpace,
  onRename,
  onRemove,
  onDrag,
  onDragOverProfile,
  onDropSpace
}: {
  profile: ProfileSummary;
  divided: boolean;
  named: boolean;
  removable: boolean;
  drag: SpaceDrag | null;
  onOpen: (space: SpaceSummary) => void;
  onEdit: (space: SpaceSummary) => void;
  onDelete: (space: SpaceSummary) => void;
  onMove: (space: SpaceSummary, delta: -1 | 1) => void;
  onNewSpace: () => void;
  onRename: () => void;
  onRemove: () => void;
  onDrag: (space: SpaceSummary | null) => void;
  onDragOverProfile: (profileId: string) => void;
  onDropSpace: (space: SpaceSummary) => void;
}): React.JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number; space: SpaceSummary } | null>(null);

  // A space is copied into another profile, never into its own.
  const isTarget = drag !== null && !profile.spaces.some((s) => s.id === drag.space.id);

  const menuItems = (space: SpaceSummary, index: number): MenuItem[] => [
    { label: 'Open', onClick: () => onOpen(space) },
    { label: 'Edit space', onClick: () => onEdit(space) },
    { label: 'Delete', danger: true, onClick: () => onDelete(space) },
    { label: 'Move up', disabled: index === 0, onClick: () => onMove(space, -1) },
    {
      label: 'Move down',
      disabled: index === profile.spaces.length - 1,
      onClick: () => onMove(space, 1)
    }
  ];

  return (
    <section
      className={`profile-group${isTarget && drag.over === profile.id ? ' drop-target' : ''}`}
      onDragOver={(e) => {
        if (!drag) return;
        if (!isTarget) {
          // Back over its own profile: nothing is a drop target now.
          if (drag.over !== '') onDragOverProfile('');
          return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (drag.over !== profile.id) onDragOverProfile(profile.id);
      }}
      onDrop={(e) => {
        if (!isTarget) return;
        e.preventDefault();
        onDropSpace(drag.space);
      }}
    >
      {divided && <div className="profile-divider" />}
      {named && (
        <button className="profile-name" title="Rename profile" onClick={onRename}>
          {profile.name}
        </button>
      )}

      <div className="space-grid">
        {profile.spaces.map((space, index) => (
          <button
            key={space.id}
            className={`space-tile${drag?.space.id === space.id ? ' dragging' : ''}`}
            // The tile wears its space's color, so the grid reads as the set of
            // spaces rather than a wall of identical panels.
            style={washVars(space.colorScheme)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'copy';
              e.dataTransfer.setData('text/plain', space.name);
              onDrag(space);
            }}
            onDragEnd={() => onDrag(null)}
            onClick={() => onOpen(space)}
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

        <button className="space-tile space-tile-new" onClick={onNewSpace}>
          <div className="space-tile-art">
            <span className="tile-glyph">＋</span>
          </div>
          <span className="space-tile-name">New space</span>
        </button>

        {removable && (
          <button className="space-tile space-tile-new space-tile-remove" onClick={onRemove}>
            <div className="space-tile-art">
              <span className="tile-glyph">✕</span>
            </div>
            <span className="space-tile-name">Remove profile</span>
          </button>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(
            menu.space,
            profile.spaces.findIndex((s) => s.id === menu.space.id)
          )}
          onClose={() => setMenu(null)}
        />
      )}
    </section>
  );
}

function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed.length === 0 ? '?' : trimmed[0].toUpperCase();
}

import { useEffect, useState } from 'react';
import type { SpaceLink } from '@shared/types';
import type { Side, SuggestionDto } from '@shared/space-types';
import { invoke } from '../ipc';
import { useOverlay } from './overlay';
import { ContextMenu } from '../components/ContextMenu';
import { LinkDialog } from './LinkDialog';
import { GridIcon, OneShotIcon, PlusIcon } from '../components/Icons';
import { SuggestInput } from './SuggestInput';

type Dialog = { kind: 'add' } | { kind: 'edit'; link: SpaceLink } | null;

/**
 * The space menu (docs/ui.md → Space menu): a panel over the section's page —
 * search box, link grid, and a footer of the actions that open a window. It
 * light-dismisses like any flyout, so the page it covers is never unloaded.
 */
export function SpaceMenu({
  spaceId,
  side,
  links,
  onClose
}: {
  spaceId: string;
  side: Side;
  links: SpaceLink[];
  onClose: () => void;
}): React.JSX.Element {
  const overlay = useOverlay();
  const [menu, setMenu] = useState<{ x: number; y: number; link: SpaceLink } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  // The chrome must draw above the page this panel covers.
  useEffect(() => {
    overlay.acquire();
    return () => overlay.release();
  }, [overlay]);

  // Escape belongs to whatever opened over the menu until it is gone.
  useEffect(() => {
    if (dialog || menu) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, menu, onClose]);

  const orderedLinks = dragOrder
    ? (dragOrder.map((id) => links.find((l) => l.id === id)).filter(Boolean) as SpaceLink[])
    : links;

  const submit = (text: string, suggestion: SuggestionDto | null): void => {
    onClose();
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
    <>
      {/* Fixed light-dismiss scrim; the panel is a sibling so it can anchor to
          this section's .web-chrome instead of the window. */}
      <div className="overlay" onMouseDown={onClose} />
      <div className="flyout space-menu">
        <div className="space-menu-search">
          <SuggestInput
            windowId={spaceId}
            side={side}
            includeTrail={false}
            placeholder="Search or enter address"
            clearOnSubmit
            autoFocus
            onSubmit={submit}
          />
        </div>

        <div className="space-menu-grid">
          {links.length === 0 && (
            <div className="space-menu-empty">Nothing pinned yet — add a link below.</div>
          )}
          {orderedLinks.map((link) => (
            <button
              key={link.id}
              className={`space-menu-tile${dragId === link.id ? ' dragging' : ''}`}
              title={link.title}
              draggable
              onClick={() => {
                onClose();
                void invoke('section:openLink', spaceId, side, link.id);
              }}
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
                next.splice(
                  next.indexOf(link.id) < 0 ? next.length : next.indexOf(link.id),
                  0,
                  dragId
                );
                if (next.join() !== dragOrder.join()) setDragOrder(next);
              }}
              onDragEnd={commitReorder}
            >
              <span className="space-menu-tile-icon">
                {link.icon ? (
                  <img
                    src={`flank-icon://data/${link.icon.replace(/\\/g, '/')}`}
                    alt=""
                    draggable={false}
                  />
                ) : (
                  <span className="space-menu-tile-letter">{initialOf(link.title)}</span>
                )}
              </span>
              <span className="space-menu-tile-title">{link.title}</span>
            </button>
          ))}
        </div>

        <div className="flyout-separator" />
        <div className="space-menu-footer">
          <button className="button small" onClick={() => setDialog({ kind: 'add' })}>
            <PlusIcon />
            Add link
          </button>
          <div className="space-menu-footer-spacer" />
          {side === 'left' && (
            <>
              <button
                className="icon-button"
                title="1-shot window"
                onClick={() => {
                  onClose();
                  void invoke('oneshot:open', spaceId);
                }}
              >
                <OneShotIcon />
              </button>
              <button
                className="icon-button"
                title="Spaces"
                onClick={() => {
                  onClose();
                  void invoke('manager:open');
                }}
              >
                <GridIcon />
              </button>
            </>
          )}
        </div>
      </div>

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
          initialNavigateInPlace={false}
          onSubmit={(title, url, navigateInPlace) => {
            setDialog(null);
            void invoke('links:add', spaceId, { title, url, navigateInPlace });
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'edit' && (
        <LinkDialog
          title="Edit link"
          initialTitle={dialog.link.title}
          initialUrl={dialog.link.url}
          initialNavigateInPlace={dialog.link.navigateInPlace ?? false}
          onSubmit={(title, url, navigateInPlace) => {
            setDialog(null);
            void invoke('links:update', spaceId, dialog.link.id, { title, url, navigateInPlace });
          }}
          onCancel={() => setDialog(null)}
        />
      )}
    </>
  );
}

function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed.length === 0 ? '?' : trimmed[0].toUpperCase();
}

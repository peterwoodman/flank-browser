import { useState } from 'react';
import type { ProfileSummary, SpaceSummary } from '@shared/ipc-types';
import { invoke } from '../ipc';
import { NamePrompt, Confirm } from '../components/Modal';
import { PlusIcon } from '../components/Icons';
import { EditSpaceDialog } from './EditSpaceDialog';
import { ProfileGroup, SpaceDrag } from './ProfileGroup';

type Dialog =
  | { kind: 'newSpace'; profile: ProfileSummary }
  | { kind: 'edit'; space: SpaceSummary }
  | { kind: 'delete'; space: SpaceSummary }
  | { kind: 'newProfile' }
  | { kind: 'renameProfile'; profile: ProfileSummary }
  | { kind: 'removeProfile'; profile: ProfileSummary }
  | { kind: 'duplicate'; space: SpaceSummary; profile: ProfileSummary }
  | null;

/**
 * The Manager's main view: each profile's spaces as a row of 132x132 tiles,
 * with "Add profile" at the bottom of the canvas. Profile names only appear
 * once there is more than one — with a single profile the launcher is just its
 * spaces.
 */
export function SpaceGrid({
  profiles,
  onChanged
}: {
  profiles: ProfileSummary[];
  onChanged: () => void;
}): React.JSX.Element {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [drag, setDrag] = useState<SpaceDrag | null>(null);

  const close = (): void => setDialog(null);

  /** Dismiss the dialog that asked for it, then show the result. */
  const apply = (action: Promise<unknown>): void => {
    close();
    void action.then(onChanged);
  };

  return (
    <div className="profiles-view">
      {profiles.map((profile, index) => (
        <ProfileGroup
          key={profile.id}
          profile={profile}
          divided={index > 0}
          named={profiles.length > 1}
          removable={profile.spaces.length === 0 && profiles.length > 1}
          drag={drag}
          onOpen={(space) => void invoke('spaces:open', space.id).then(onChanged)}
          onEdit={(space) => setDialog({ kind: 'edit', space })}
          onDelete={(space) => setDialog({ kind: 'delete', space })}
          onMove={(space, delta) => void invoke('spaces:move', space.id, delta).then(onChanged)}
          onNewSpace={() => setDialog({ kind: 'newSpace', profile })}
          onRename={() => setDialog({ kind: 'renameProfile', profile })}
          onRemove={() => setDialog({ kind: 'removeProfile', profile })}
          onDrag={(space) => setDrag(space ? { space, over: '' } : null)}
          onDragOverProfile={(over) => setDrag((d) => (d ? { ...d, over } : null))}
          onDropSpace={(space) => {
            setDrag(null);
            setDialog({ kind: 'duplicate', space, profile });
          }}
        />
      ))}

      <button className="button profile-add" onClick={() => setDialog({ kind: 'newProfile' })}>
        <PlusIcon />
        Add profile
      </button>

      {dialog?.kind === 'newSpace' && (
        <NamePrompt
          title="New space"
          initial=""
          submitLabel="Create"
          onSubmit={(name) => apply(invoke('spaces:create', name, dialog.profile.id))}
          onCancel={close}
        />
      )}
      {dialog?.kind === 'edit' && (
        <EditSpaceDialog
          name={dialog.space.name}
          colorScheme={dialog.space.colorScheme}
          onSubmit={(name, colorScheme) =>
            apply(invoke('spaces:update', dialog.space.id, { name, colorScheme }))
          }
          onCancel={close}
        />
      )}
      {dialog?.kind === 'delete' && (
        <Confirm
          title="Delete space"
          message={`Delete "${dialog.space.name}"? Its pinned links and session are removed. Its profile's browsing data (cookies, logins) is shared with the profile's other spaces and stays.`}
          confirmLabel="Delete"
          onConfirm={() => apply(invoke('spaces:delete', dialog.space.id))}
          onCancel={close}
        />
      )}
      {dialog?.kind === 'newProfile' && (
        <NamePrompt
          title="New profile"
          initial=""
          submitLabel="Create"
          onSubmit={(name) => apply(invoke('profiles:create', name))}
          onCancel={close}
        />
      )}
      {dialog?.kind === 'renameProfile' && (
        <NamePrompt
          title="Rename profile"
          initial={dialog.profile.name}
          submitLabel="Rename"
          onSubmit={(name) => apply(invoke('profiles:rename', dialog.profile.id, name))}
          onCancel={close}
        />
      )}
      {dialog?.kind === 'removeProfile' && (
        <Confirm
          title="Remove profile"
          message={`Remove "${dialog.profile.name}"? Its browsing data — cookies, logins, and cache — is deleted. Other profiles keep theirs.`}
          confirmLabel="Remove"
          onConfirm={() => apply(invoke('profiles:remove', dialog.profile.id))}
          onCancel={close}
        />
      )}
      {dialog?.kind === 'duplicate' && (
        <Confirm
          title="Duplicate space"
          message={`Copy "${dialog.space.name}" into "${dialog.profile.name}"? The copy keeps the same pinned links, but browses with that profile's logins — so it starts signed out.`}
          confirmLabel="Duplicate"
          onConfirm={() => apply(invoke('spaces:duplicate', dialog.space.id, dialog.profile.id))}
          onCancel={close}
        />
      )}
    </div>
  );
}

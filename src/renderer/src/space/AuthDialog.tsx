import { useEffect, useRef, useState } from 'react';
import { Modal } from '../components/Modal';

export interface AuthPromptDto {
  id: string;
  address: string;
  realm: string;
  isProxy: boolean;
  retry: boolean;
  insecure: boolean;
}

export interface AuthAnswerDto {
  username: string;
  password: string;
}

/**
 * The sign-in dialog for a server's HTTP authentication challenge
 * (docs/behaviors.md → Media, permissions, and dialogs). It names who is
 * asking, since a challenge can come from a page's subresource or a proxy
 * rather than the address on screen, and warns when the credentials would
 * cross the network in the clear.
 */
export function AuthDialog({
  prompt,
  onAnswer
}: {
  prompt: AuthPromptDto;
  onAnswer: (answer: AuthAnswerDto | null) => void;
}): React.JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  // Empty fields are a legitimate answer some servers expect, so they are sent
  // rather than blocked; the server refusing them asks again.
  const submit = (): void => onAnswer({ username, password });

  return (
    <Modal title="Sign in" onDismiss={() => onAnswer(null)} className="auth-dialog">
      <p className="modal-message">
        {prompt.isProxy ? 'The proxy at ' : ''}
        <strong>{prompt.address}</strong> requires a username and password.
      </p>
      {prompt.realm && <p className="auth-realm">{prompt.realm}</p>}
      {prompt.retry && <p className="auth-warning">That sign-in was not accepted.</p>}
      {prompt.insecure && (
        <p className="auth-warning">
          This connection is not encrypted. Anyone between you and the site can read what you send.
        </p>
      )}
      <input
        ref={usernameRef}
        className="text-input"
        placeholder="Username"
        autoComplete="off"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      <input
        className="text-input"
        type="password"
        placeholder="Password"
        autoComplete="off"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      <div className="modal-buttons">
        <button className="button primary" onClick={submit}>
          Sign in
        </button>
        <button className="button" onClick={() => onAnswer(null)}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

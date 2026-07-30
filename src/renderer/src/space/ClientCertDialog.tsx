import { useState } from 'react';
import type { ClientCertDto } from '@shared/space-types';
import { Modal } from '../components/Modal';

export interface ClientCertPromptDto {
  id: string;
  certificates: ClientCertDto[];
}

/**
 * Which certificate to identify with when a server asks the browser to prove
 * who it is (docs/behaviors.md → Certificate errors). Sending none is a real
 * answer — the server decides what to do about it — so Cancel is not a way of
 * dodging the question.
 */
export function ClientCertDialog({
  prompt,
  onAnswer
}: {
  prompt: ClientCertPromptDto;
  onAnswer: (fingerprint: string | null) => void;
}): React.JSX.Element {
  const [selected, setSelected] = useState(prompt.certificates[0]?.fingerprint ?? null);

  return (
    <Modal title="Choose a certificate" onDismiss={() => onAnswer(null)}>
      <p className="modal-message">
        A server is asking Flank to identify itself. The certificate you choose, and who issued it,
        is shown to that server.
      </p>
      <div className="client-cert-list">
        {prompt.certificates.map((cert) => (
          <button
            key={cert.fingerprint}
            className={
              cert.fingerprint === selected ? 'client-cert-item selected' : 'client-cert-item'
            }
            onClick={() => setSelected(cert.fingerprint)}
            onDoubleClick={() => onAnswer(cert.fingerprint)}
          >
            <span className="client-cert-subject">{cert.subject}</span>
            <span className="client-cert-detail">
              Issued by {cert.issuer} · expires {cert.expiresAt.slice(0, 10)}
            </span>
          </button>
        ))}
      </div>
      <div className="modal-buttons">
        <button
          className="button primary"
          disabled={!selected}
          onClick={() => selected && onAnswer(selected)}
        >
          Send certificate
        </button>
        <button className="button" onClick={() => onAnswer(null)}>
          Send none
        </button>
      </div>
    </Modal>
  );
}

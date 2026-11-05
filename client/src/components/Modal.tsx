import { useState, type FormEvent, type ReactNode } from 'react';

type Props = {
  title: string;
  label: string;
  placeholder?: string;
  confirmText?: string;
  onClose: () => void;
  onSubmit: (value: string) => Promise<void> | void;
};

export function PromptModal({
  title,
  label,
  placeholder,
  confirmText = '确定',
  onClose,
  onSubmit,
}: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await onSubmit(value.trim());
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{title}</h3>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="field">
          <label>{label}</label>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            autoFocus
            required
          />
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={loading}>
            {confirmText}
          </button>
        </div>
      </form>
    </div>
  );
}

export function SimpleModal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
        <div className="modal-actions">
          <button type="button" className="primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

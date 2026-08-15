import { useToast } from "../store/toast";

export function Toast() {
  const message = useToast((s) => s.message);
  if (!message) return null;
  return (
    <div className="toast" role="status" data-testid="toast">
      <span aria-hidden>📋</span>
      {message}
    </div>
  );
}

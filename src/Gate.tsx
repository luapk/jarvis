import { useState, type ReactNode } from "react";

// A soft splash gate. This is not security: the check runs in the browser and
// can be bypassed. It only keeps the installation behind a simple entry screen.
const PASSWORD = "jarvis";
const STORAGE_KEY = "observer-unlocked";

export default function Gate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(
    () => sessionStorage.getItem(STORAGE_KEY) === "1",
  );
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);

  if (unlocked) return <>{children}</>;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (value.trim().toLowerCase() === PASSWORD) {
      sessionStorage.setItem(STORAGE_KEY, "1");
      setUnlocked(true);
    } else {
      setError(true);
    }
  };

  return (
    <div className="splash">
      <form className="splash-card" onSubmit={submit}>
        <div className="splash-brand">
          <span className="dot" /> J.A.R.V.I.S.
        </div>
        <div className="splash-title">OBSERVER</div>
        <p className="splash-sub">Access restricted. Do announce yourself.</p>
        <input
          className={"splash-input" + (error ? " error" : "")}
          type="password"
          value={value}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="Passphrase"
          aria-label="Passphrase"
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(false);
          }}
        />
        <button className="splash-enter" type="submit">
          Enter
        </button>
        <p className="splash-error" role="alert">
          {error ? "I am afraid that will not do, sir." : ""}
        </p>
      </form>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { api, ServerInfo } from "../api";

export function SignIn(props: { onAuthed: () => void; onBrowseCached: () => void }) {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearInterval(pollRef.current), []);

  async function signIn() {
    setError(null);
    try {
      const pin = await api.createPin();
      window.open(pin.authUrl, "_blank", "noopener");
      setWaiting(true);
      pollRef.current = window.setInterval(async () => {
        try {
          const r = await api.checkPin(pin.pinId);
          if (r.authenticated) {
            window.clearInterval(pollRef.current);
            props.onAuthed();
          }
        } catch {
          /* keep polling */
        }
      }, 2000);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="centered">
      <h1 className="logo">
        Plex<span>Tags</span>
      </h1>
      <p className="muted">
        Edit the genre tags of your Plex library like a channel lineup.
      </p>
      {waiting ? (
        <p className="pulse">Waiting for you to approve in the Plex tab…</p>
      ) : (
        <button className="primary big" onClick={signIn}>
          Sign in with Plex
        </button>
      )}
      {error && <p className="error">{error}</p>}
      <button className="link" onClick={props.onBrowseCached}>
        Browse cached data without signing in
      </button>
    </div>
  );
}

export function ServerPicker(props: { onSelected: () => void }) {
  const [servers, setServers] = useState<ServerInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picking = useRef(false);

  useEffect(() => {
    api.servers().then(setServers, (e) => setError(String(e)));
  }, []);

  async function pick(s: ServerInfo) {
    if (!s.url || picking.current) return;
    picking.current = true;
    await api.selectServer({ name: s.name, url: s.url, accessToken: s.accessToken });
    props.onSelected();
  }

  // Auto-select when there's exactly one reachable server.
  useEffect(() => {
    const reachable = servers?.filter((s) => s.reachable) ?? [];
    if (reachable.length === 1) pick(reachable[0]);
  }, [servers]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="centered error">{error}</div>;
  if (!servers) return <div className="centered pulse">Finding your Plex servers…</div>;
  return (
    <div className="centered">
      <h2>Pick your server</h2>
      {servers.length === 0 && <p>No Plex Media Servers found on this account.</p>}
      {servers.map((s) => (
        <button
          key={s.clientIdentifier}
          className="server"
          disabled={!s.reachable}
          onClick={() => pick(s)}
        >
          <strong>{s.name}</strong>
          <span className="muted">{s.url ?? "unreachable"}</span>
        </button>
      ))}
    </div>
  );
}

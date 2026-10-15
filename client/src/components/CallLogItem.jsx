import Icon from './Icons';

const formatTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// What a finished call looks like to ME (the same call reads differently for the caller and the receiver)
function describe(c, myId) {
  const outgoing = c.caller_id === myId;
  const kind = c.kind === 'video' ? 'video' : 'voice';
  const Kind = kind[0].toUpperCase() + kind.slice(1);
  switch (c.outcome) {
    case 'completed':
      return { text: `${Kind} call`, tone: 'ok', detail: formatDuration(c.duration_s) };
    case 'declined':
      return outgoing ? { text: `${Kind} call declined`, tone: 'bad' } : { text: `You declined a ${kind} call`, tone: 'muted' };
    case 'cancelled':
      return outgoing ? { text: `Cancelled ${kind} call`, tone: 'muted' } : { text: `Missed ${kind} call`, tone: 'bad' };
    default:
      return outgoing ? { text: `No answer (${kind} call)`, tone: 'muted' } : { text: `Missed ${kind} call`, tone: 'bad' };
  }
}

// One entry of the call history, shown inside the conversation like a message
export default function CallLogItem({ c, myId, onCallBack, canCall }) {
  const outgoing = c.caller_id === myId;
  const { text, tone, detail } = describe(c, myId);
  return (
    <div className="call-log">
      <div className={`call-log-card ${tone}`}>
        <span className="call-log-ico"><Icon name={c.kind === 'video' ? 'video' : 'phone'} size={18} /></span>
        <div className="call-log-text">
          <strong>{text}</strong>
          <small>
            {outgoing ? 'Outgoing' : 'Incoming'}
            {detail ? ` · ${detail}` : ''} · <time title={new Date(c.created_at).toLocaleString()}>{formatTime(c.created_at)}</time>
          </small>
        </div>
        <button
          type="button"
          className="call-log-again"
          onClick={() => onCallBack(c.kind)}
          disabled={!canCall}
          title={canCall ? 'Call again' : 'They need to be online to call'}
        >
          Call back
        </button>
      </div>
    </div>
  );
}

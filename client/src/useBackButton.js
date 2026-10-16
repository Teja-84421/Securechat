import { useEffect, useRef } from 'react';

// Makes the phone's Back button / back gesture close the thing on top (a chat, a dialog, the details panel)
// instead of leaving the app. Each open "layer" adds one history entry; Back removes the top layer only.
const stack = []; // open layers, top = last
let ignore = 0; // popstate events caused by OUR OWN history.back() calls
let listening = false;

function onPop() {
  if (ignore > 0) {
    ignore -= 1;
    return;
  }
  const top = stack.pop();
  if (top) top.close();
}

// Returns a function that removes the layer again (when the UI closed it without the Back button)
export function pushLayer(close) {
  const layer = { close };
  stack.push(layer);
  window.history.pushState({ ...(window.history.state || {}), securechatLayer: true }, '');
  if (!listening) {
    window.addEventListener('popstate', onPop);
    listening = true;
  }
  return () => {
    const i = stack.indexOf(layer);
    if (i === -1) return; // already closed by the Back button
    stack.splice(i, 1);
    ignore += 1;
    window.history.back();
  };
}

export function useBackButton(open, onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    return pushLayer(() => closeRef.current());
  }, [open]);
}

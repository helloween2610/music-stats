export function lockTextSelection() {
  const root=document.documentElement;
  const selection=window.getSelection();
  selection?.removeAllRanges();
  root.classList.add('shortcut-selection-lock');
  const stop=(event:Event)=>event.preventDefault();
  document.addEventListener('selectstart',stop,true);
  document.addEventListener('dragstart',stop,true);
  return () => {
    root.classList.remove('shortcut-selection-lock');
    window.getSelection()?.removeAllRanges();
    document.removeEventListener('selectstart',stop,true);
    document.removeEventListener('dragstart',stop,true);
  };
}

import {createContext,useEffect,useRef,useState,type ReactElement,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {useSheetMotion,useSheetSwipeDismiss} from './shortcut-sheet-controls';
import {lockTextSelection} from '@/lib/selection-lock';
import type {MetaItem} from '@/lib/metadata';
import type {MetadataExplanation} from '@/lib/metadata-help';

const HelpContext=createContext<((value:MetadataExplanation)=>void)|null>(null);
export function MetadataHelpProvider({screenKey,children}:{screenKey:string;children:ReactNode}) {
  const [value,setValue]=useState<MetadataExplanation|null>(null);
  useEffect(()=>setValue(null),[screenKey]);
  return <HelpContext.Provider value={setValue}>{children}{value&&<MetadataHelpSheet value={value} close={()=>setValue(null)}/>}</HelpContext.Provider>;
}
/** Keep the original element and normal tap, with a separate hold target inside row shortcuts. */
export function MetadataHelp({item,children}:{item:MetaItem;children:ReactElement<any>}) {
  void item;
  return children;
}
function MetadataHelpSheet({value,close:onDismiss}:{value:MetadataExplanation;close:()=>void}) {
  const {close,motionProps}=useSheetMotion(onDismiss);
  const swipeDismiss=useSheetSwipeDismiss(close);
  const button=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
    const unlockSelection=lockTextSelection();
    button.current?.focus({preventScroll:true});
    return()=>{unlockSelection();document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[]);
  return createPortal(<div {...motionProps} className="shortcut-backdrop" onClick={e=>{if(e.currentTarget===e.target)close();}}>
    <div {...swipeDismiss} className="shortcut-sheet" role="dialog" aria-modal="true" aria-label={'Quy tắc: '+value.title} onKeyDown={e=>{
      if(e.key==='Escape'){e.preventDefault();close();}
      if(e.key==='Tab'){e.preventDefault();button.current?.focus();}
    }}>
      <div className="shortcut-handle"/>
      <div className="shortcut-heading"><strong>{value.title} · {value.value}</strong></div>
      <div className="metadata-help-copy">{value.lines.map((line,i)=><p key={i}>{line}</p>)}</div>
      <button ref={button} type="button" className="shortcut-close" onClick={close}>Đóng</button>
    </div>
  </div>,document.body);
}

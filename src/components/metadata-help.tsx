import {cloneElement,createContext,useContext,useEffect,useRef,useState,type ReactElement,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import type {MetaItem} from '@/lib/metadata';
import {explainMetadata,type MetadataExplanation} from '@/lib/metadata-help';
import {longPress} from '@/lib/long-press';

const HelpContext=createContext<((value:MetadataExplanation)=>void)|null>(null);
export function MetadataHelpProvider({screenKey,children}:{screenKey:string;children:ReactNode}) {
  const [value,setValue]=useState<MetadataExplanation|null>(null);
  useEffect(()=>setValue(null),[screenKey]);
  return <HelpContext.Provider value={setValue}>{children}{value&&<MetadataHelpSheet value={value} close={()=>setValue(null)}/>}</HelpContext.Provider>;
}
/** Keep the original element and normal tap, with a separate hold target inside row shortcuts. */
export function MetadataHelp({item,children}:{item:MetaItem;children:ReactElement<any>}) {
  const open=useContext(HelpContext), latest=useRef(()=>{});
  latest.current=()=>open?.(explainMetadata(item));
  const gesture=useRef<ReturnType<typeof longPress>>();
  if(!gesture.current)gesture.current=longPress(()=>latest.current());
  useEffect(()=>()=>gesture.current?.cancel(),[]);
  const old=children.props;
  const summary=explainMetadata(item);
  return cloneElement(children,{
    className:[old.className,'metadata-help-target'].filter(Boolean).join(' '),
    tabIndex:0,'aria-haspopup':'dialog',
    title:[`${item.title}: ${item.detail||item.text}`,...summary.lines,'Nhấn giữ để xem quy tắc.'].join('\n'),
    onPointerDown:(e:React.PointerEvent)=>{e.stopPropagation();if(!e.isPrimary||e.button!==0){gesture.current!.cancel();return;}gesture.current!.start(e.clientX,e.clientY);},
    onPointerMove:(e:React.PointerEvent)=>gesture.current!.move(e.clientX,e.clientY),
    onPointerUp:()=>gesture.current!.end(),onPointerCancel:()=>gesture.current!.cancel(),onPointerLeave:()=>gesture.current!.cancel(),
    onClickCapture:(e:React.MouseEvent)=>{if(gesture.current!.consumeClick()){e.preventDefault();e.stopPropagation();}},
    onContextMenu:(e:React.MouseEvent)=>{e.preventDefault();e.stopPropagation();gesture.current!.blockClick();latest.current();},
    onKeyDown:(e:React.KeyboardEvent)=>{if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();e.stopPropagation();latest.current();}},
  });
}
function MetadataHelpSheet({value,close}:{value:MetadataExplanation;close:()=>void}) {
  const button=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';button.current?.focus();
    return()=>{document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[]);
  return createPortal(<div className="shortcut-backdrop" onClick={e=>{if(e.currentTarget===e.target)close();}}>
    <div className="shortcut-sheet" role="dialog" aria-modal="true" aria-label={'Quy tắc: '+value.title} onKeyDown={e=>{
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

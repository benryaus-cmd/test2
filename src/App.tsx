import assetsData from "@/config/assets";
import { aippyTweaks } from '@aippy/runtime/tweaks';
import tweaksConfig from '@/config/tweaksConfig.json';
import EngagementTester from '@/components/EngagementTester';
import AccountActivityPanel from '@/components/AccountActivityPanel';
import ProjectFiles from '@/dev/ProjectFiles';
import StorageExplorer from '@/dev/StorageExplorer';
import { useState, type CSSProperties } from 'react';

const tweaks = aippyTweaks(tweaksConfig);
const cogAsset = assetsData.IMAGE_NKDD;

function App() {
  const pageColor = tweaks.pageColor.useState();
  const panelColor = tweaks.panelColor.useState();
  const inkColor = tweaks.inkColor.useState();
  const accentColor = tweaks.accentColor.useState();
  const cornerRadius = tweaks.cornerRadius.useState();
  const compactLayout = tweaks.compactLayout.useState();
  const [projectFilesOpen, setProjectFilesOpen] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const themeStyle = {
    '--page-color': pageColor, '--panel-color': panelColor,
    '--ink-color': inkColor, '--accent-color': accentColor,
    '--card-radius': cornerRadius + 'px'
  } as CSSProperties;

  return <div className={compactLayout ? 'app-theme compact-layout' : 'app-theme'} style={themeStyle}>
    <EngagementTester />
    <AccountActivityPanel />
    <style>{`.app-theme .tester-shell .topbar{padding-right:54px}`}</style>
    <button type="button" aria-label="Open Project Files" title="Project Files"
      onClick={() => setProjectFilesOpen(true)} style={{
      position:'fixed',top:'max(8px, env(safe-area-inset-top))',right:12,zIndex:80,
      display:'grid',width:44,height:44,placeItems:'center',
      border:'1px solid #d5dee7',borderRadius:12,background:'#fff',
      boxShadow:'0 2px 8px rgba(24, 44, 62, .12)',cursor:'pointer',touchAction:'manipulation'
    }}>
      <img src={cogAsset} alt="" width="26" height="26" />
    </button>
    <button type="button" aria-label="Open Storage Explorer" title="Storage Explorer"
      onClick={() => setStorageOpen(true)} style={{
      position:'fixed', top:'max(8px, env(safe-area-inset-top))', right:64, zIndex:80,
      height:44, padding:'0 10px', border:'1px solid #d5dee7',
      borderRadius:12, background:'#fff', color:'#243947', fontSize:11,
      fontWeight:800, letterSpacing:'.025em', boxShadow:'0 2px 8px rgba(24, 44, 62, .12)',
      cursor:'pointer', touchAction:'manipulation'
    }}>STORAGE</button>
    <ProjectFiles open={projectFilesOpen} onClose={() => setProjectFilesOpen(false)} />
    <StorageExplorer open={storageOpen} onClose={() => setStorageOpen(false)} />
  </div>;
}
export default App;

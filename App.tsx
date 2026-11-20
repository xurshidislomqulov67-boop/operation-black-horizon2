/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import {
  BackpackModal,
  DossierModal,
  GameOverModal,
  PauseModal,
  SettingsModal,
} from './components/Modals';
import { TacticalHud } from './components/TacticalHud';
import { TitleScreen } from './components/TitleScreen';
import { BlackHorizonEngine } from './game/BlackHorizonEngine';
import { DuelMultiplayerClient } from './game/multiplayerClient';
import {
  normalizeRoomCode,
  type MultiplayerRoomState,
  type TargetKillsOption,
} from './game/multiplayerProtocol';
import { DEFAULT_GAME_SETTINGS, type GameSettings, type HudSnapshot } from './game/types';

const SETTINGS_STORAGE_KEY = 'bh_settings_v1';

function loadSavedSettings(): GameSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_GAME_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      lookSensitivity:
        typeof parsed.lookSensitivity === 'number'
          ? Math.max(0.3, Math.min(2.5, parsed.lookSensitivity))
          : DEFAULT_GAME_SETTINGS.lookSensitivity,
      adsSensitivity:
        typeof parsed.adsSensitivity === 'number'
          ? Math.max(0.3, Math.min(2.0, parsed.adsSensitivity))
          : DEFAULT_GAME_SETTINGS.adsSensitivity,
      invertY:
        typeof parsed.invertY === 'boolean' ? parsed.invertY : DEFAULT_GAME_SETTINGS.invertY,
      fov:
        typeof parsed.fov === 'number'
          ? Math.max(65, Math.min(95, parsed.fov))
          : DEFAULT_GAME_SETTINGS.fov,
      masterVolume:
        typeof parsed.masterVolume === 'number'
          ? Math.max(0, Math.min(1, parsed.masterVolume))
          : DEFAULT_GAME_SETTINGS.masterVolume,
    };
  } catch {
    return { ...DEFAULT_GAME_SETTINGS };
  }
}

const INITIAL_HUD: HudSnapshot = {
  gameState: 'title',
  gameMode: 'classic',
  cameraPerspective: 'tpp',
  outcome: 'none',
  hp: 100,
  maxHp: 100,
  stance: 'standing',
  isMounted: false,
  canMount: false,
  isAds: false,
  nvgActive: false,
  nvgBattery: 100,
  weaponId: 'mk18_suppressed',
  weaponName: 'MK18 MOD 1 // SUPPRESSED',
  magAmmo: 30,
  chambered: true,
  reserveAmmo: 150,
  mk18ReserveAmmo: 150,
  p226ReserveAmmo: 60,
  isReloading: false,
  ammoRevealTimer: 0,
  grenadeCount: 3,
  medkitCount: 1,
  bandageCount: 2,
  bagWeightKg: 7.5,
  bagMaxKg: 35,
  isHealing: false,
  healKind: null,
  healProgress: 0,
  nearbyLoot: null,
  incomingGrenade: null,
  teammates: [],
  nearbyKnockedAlly: null,
  airdropStatus: {
    nextDropInSec: 60,
    activeDropCount: 0,
    nearestDropDistanceM: null,
    justDroppedBannerSec: 0,
  },
  arenaScore: null,
  duelScore: null,
  respawnCountdownSec: 0,
  minimapBlips: [],
  headingDeg: 0,
  objectiveLabel: 'INFILTRATE PERIMETER CHECKPOINT',
  objectiveDistanceM: 26,
  objectiveBearingDeg: 0,
  phaseIndex: 0,
  totalPhases: 4,
  activeComms: null,
  interactPrompt: null,
  damageFlashAlpha: 0,
  damageDirRad: null,
  hitMarkerTimer: 0,
  hitMarkerHeadshot: false,
  flashbangStunTimer: 0,
  pointerLocked: false,
  isMuted: false,
  elapsedSec: 0,
  kills: 0,
  headshots: 0,
  shotsFired: 0,
  shotsHit: 0,
  stealthAlerted: false,
  breachesCompleted: 0,
};

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<BlackHorizonEngine | null>(null);
  const duelClientRef = useRef<DuelMultiplayerClient | null>(null);

  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [dossierOpen, setDossierOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bagOpen, setBagOpen] = useState(false);
  const [settings, setSettings] = useState<GameSettings>(() => loadSavedSettings());
  const initialSettingsRef = useRef(settings);

  // 1v1 Hotspot Multiplayer Lobby State
  const [playerName, setPlayerName] = useState('SPECTER-01');
  const [joinCode, setJoinCode] = useState('');
  const [targetKills, setTargetKills] = useState<TargetKillsOption>(20);
  const [durationSec, setDurationSec] = useState<number>(300);
  const [roomState, setRoomState] = useState<MultiplayerRoomState | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [duelError, setDuelError] = useState<string | null>(null);
  const [lanUrls, setLanUrls] = useState<string[]>([]);
  const [originUrl, setOriginUrl] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
  );

  // Mount Three.js engine + WebSocket multiplayer client once
  useEffect(() => {
    document.body.dataset.state = 'title';
    const container = canvasMountRef.current;
    if (!container) return;

    const engine = new BlackHorizonEngine(container, (snapshot) => {
      setHud(snapshot);
    });
    engine.applySettings(initialSettingsRef.current);
    engineRef.current = engine;

    const client = new DuelMultiplayerClient({
      onConnectionChange: (connected) => setWsConnected(connected),
      onRoomState: (room) => {
        setDuelError(null);
        setRoomState(room);
        setTargetKills(room.targetKills);
        setDurationSec(room.durationSec);
        engine.syncDuelRoomState(room);
      },
      onMatchStarted: (room) => {
        setDuelError(null);
        setRoomState(room);
        setBagOpen(false);
        setSettingsOpen(false);
        setDossierOpen(false);
        engine.startDuelMatch(room, client);
      },
      onRemotePose: (pose) => engine.applyRemoteOpponentPose(pose),
      onRemoteShotFx: (fx) => engine.applyRemoteShotFx(fx),
      onDamageEvent: (ev) =>
        engine.applyDuelDamageEvent(ev.victimSlot, ev.victimHp, ev.headshot),
      onKillEvent: (ev) =>
        engine.applyDuelKillEvent(
          ev.killerSlot,
          ev.victimSlot,
          ev.p1Kills,
          ev.p2Kills,
          ev.respawnDelaySec,
        ),
      onMatchOver: (room) => {
        setRoomState(room);
        engine.finishDuelMatch(room);
      },
      onError: (msg) => setDuelError(msg),
    });
    client.connect();
    duelClientRef.current = client;

    // Fetch Hotspot / LAN IP URLs from server
    fetch('/api/network-info')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { lanUrls?: string[]; originUrl?: string } | null) => {
        if (data?.lanUrls) setLanUrls(data.lanUrls);
        if (data?.originUrl) setOriginUrl(data.originUrl);
      })
      .catch(() => {});

    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      const code = normalizeRoomCode(roomParam);
      if (code) {
        setJoinCode(code);
        setPlayerName("DO'ST-02");
        engine.setGameMode('duel_1v1');
      }
    } else if (params.get('autostart') === '1') {
      engine.startMission(false);
    }

    return () => {
      client.disconnect();
      duelClientRef.current = null;
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // Sync sensitivity / FOV / volume settings to engine & localStorage
  const handleSettingsChange = (next: GameSettings) => {
    setSettings(next);
    engineRef.current?.applySettings(next);
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors in restricted frames
    }
  };

  const openBagModal = () => {
    if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }
    setBagOpen(true);
  };

  // Enter / Space handshake on Title Screen (non-duel), Tab toggles Bag/Sumka, Escape closes modals
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.code === 'Escape') {
        if (bagOpen) {
          setBagOpen(false);
          return;
        }
        if (settingsOpen) {
          setSettingsOpen(false);
          return;
        }
        if (dossierOpen) {
          setDossierOpen(false);
          return;
        }
      }
      if (e.code === 'Tab' && (hud.gameState === 'playing' || hud.gameState === 'title')) {
        e.preventDefault();
        if (settingsOpen || dossierOpen) return;
        setBagOpen((prev) => {
          const next = !prev;
          if (next && document.pointerLockElement) {
            document.exitPointerLock?.();
          }
          return next;
        });
        return;
      }
      if (
        hud.gameState === 'title' &&
        hud.gameMode !== 'duel_1v1' &&
        !dossierOpen &&
        !settingsOpen &&
        !bagOpen
      ) {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          engineRef.current?.startMission();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hud.gameState, hud.gameMode, dossierOpen, settingsOpen, bagOpen]);

  const handleStart = () => {
    setDossierOpen(false);
    setSettingsOpen(false);
    setBagOpen(false);
    engineRef.current?.startMission();
  };

  const handleSelectTargetKills = (opt: TargetKillsOption) => {
    setTargetKills(opt);
    engineRef.current?.setTargetKills(opt);
    if (roomState && roomState.mySlot === 1) {
      duelClientRef.current?.updateRoomConfig(opt, durationSec);
    }
  };

  const handleSelectDurationSec = (sec: number) => {
    setDurationSec(sec);
    engineRef.current?.setMatchDurationSec(sec);
    if (roomState && roomState.mySlot === 1) {
      duelClientRef.current?.updateRoomConfig(targetKills, sec);
    }
  };

  return (
    <div className="relative w-full h-full bg-neutral-950 overflow-hidden">
      {/* Isolated WebGL mount container */}
      <div
        ref={canvasMountRef}
        data-testid="game-canvas-container"
        className="fixed inset-0 w-full h-full"
      />

      {/* PUBG Mobile-Style Title Lobby */}
      {hud.gameState === 'title' && (
        <TitleScreen
          gameMode={hud.gameMode}
          cameraPerspective={hud.cameraPerspective}
          targetKills={targetKills}
          durationSec={durationSec}
          playerName={playerName}
          joinCode={joinCode}
          roomState={roomState}
          inviteBaseUrl={originUrl}
          lanUrls={lanUrls}
          duelError={duelError}
          wsConnected={wsConnected}
          onChangePlayerName={setPlayerName}
          onChangeJoinCode={setJoinCode}
          onSelectMode={(mode) => {
            setDuelError(null);
            engineRef.current?.setGameMode(mode);
          }}
          onSelectPerspective={(persp) => engineRef.current?.setCameraPerspective(persp)}
          onSelectTargetKills={handleSelectTargetKills}
          onSelectDurationSec={handleSelectDurationSec}
          onCreateRoom={() => {
            setDuelError(null);
            duelClientRef.current?.createRoom(playerName, targetKills, durationSec);
          }}
          onJoinRoom={() => {
            setDuelError(null);
            duelClientRef.current?.joinRoom(joinCode, playerName);
          }}
          onLeaveRoom={() => {
            duelClientRef.current?.leaveRoom();
            setRoomState(null);
          }}
          onStartDuel={() => {
            setDuelError(null);
            duelClientRef.current?.startMatch();
          }}
          onStart={handleStart}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenBag={openBagModal}
          onOpenDossier={() => setDossierOpen(true)}
        />
      )}

      {/* Playing HUD */}
      {hud.gameState === 'playing' && (
        <>
          <TacticalHud
            hud={hud}
            onToggleMute={() => engineRef.current?.toggleMute()}
            onPause={() => engineRef.current?.pauseMission()}
            onOpenSettings={() => {
              engineRef.current?.pauseMission();
              setSettingsOpen(true);
            }}
            onTogglePerspective={() => engineRef.current?.togglePerspective()}
            onReviveAlly={() => engineRef.current?.triggerReviveNearby()}
            onOpenBag={openBagModal}
          />
          {hud.respawnCountdownSec > 0 && (
            <div className="fixed inset-0 z-20 flex items-center justify-center bg-neutral-950/65 pointer-events-none">
              <div className="bg-neutral-900 border border-red-500 px-6 py-4 text-center font-mono">
                <div className="text-xs uppercase text-red-400">ELIMINATED IN 1v1 DUEL</div>
                <div className="mt-1 text-2xl font-black text-stone-100 tabular-nums">
                  RESPAWNING IN {hud.respawnCountdownSec}S...
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Pause Modal */}
      {hud.gameState === 'paused' && (
        <PauseModal
          onResume={() => engineRef.current?.resumeMission()}
          onRestart={handleStart}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenDossier={() => setDossierOpen(true)}
          onTitle={() => engineRef.current?.returnToTitle()}
        />
      )}

      {/* Victory / Game Over Modal */}
      {hud.gameState === 'gameover' && (
        <GameOverModal
          hud={hud}
          onRestart={handleStart}
          onRematch={() => duelClientRef.current?.rematch()}
          onOpenDossier={() => setDossierOpen(true)}
          onTitle={() => engineRef.current?.returnToTitle()}
        />
      )}

      {/* Backpack / Sumka Modal */}
      {bagOpen && (
        <BackpackModal
          hud={hud}
          inMatch={hud.gameState === 'playing'}
          onEquipWeapon={(id) => engineRef.current?.equipWeapon(id)}
          onUseItem={(kind) => {
            engineRef.current?.useBagItem(kind);
            setBagOpen(false);
          }}
          onClose={() => setBagOpen(false)}
        />
      )}

      {/* Sensitivity & Audio Settings Modal */}
      {settingsOpen && (
        <SettingsModal
          settings={settings}
          onChange={handleSettingsChange}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* Module 1 Script & UE5 C++ Architecture Dossier */}
      {dossierOpen && <DossierModal onClose={() => setDossierOpen(false)} />}
    </div>
  );
}

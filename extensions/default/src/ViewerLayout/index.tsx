import React, { useEffect, useState, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { sendPromptToLLM, transcribeAudio, translateToEnglish } from '../../../../platform/app/src/routes/WorkList/llmService';
import { useRecorder } from '../../../../platform/app/src/routes/WorkList/useRecorder';
import { usePorcupine } from '@picovoice/porcupine-react';
import { PICO_KEY } from '../../../../platform/app/src/routes/WorkList/env';
import { PORCUPINE_MODEL_BASE64, HEY_PACS_KEYWORD_BASE64 } from '../../../../platform/app/src/routes/WorkList/porcupineConfig';

import {
  SidePanel,
  ErrorBoundary,
  UserPreferences,
  AboutModal,
  Modal,
  Header,
  useModal,
  LoadingIndicatorProgress,
} from '@ohif/ui';
import i18n from '@ohif/i18n';
import {
  ServicesManager,
  HangingProtocolService,
  hotkeys,
  CommandsManager,
} from '@ohif/core';
import { useAppConfig } from '@state';
import Toolbar from '../Toolbar/Toolbar';

const { availableLanguages, defaultLanguage, currentLanguage } = i18n;



function ViewerLayout({
  // From Extension Module Params
  extensionManager,
  servicesManager,
  hotkeysManager,
  commandsManager,
  // From Modes
  viewports,
  ViewportGridComp,
  leftPanels = [],
  rightPanels = [],
  leftPanelDefaultClosed = false,
  rightPanelDefaultClosed = false,
}): React.FunctionComponent {
  const [isVoiceDialogOpen, setIsVoiceDialogOpen] = useState(false);
  const [voiceInput, setVoiceInput] = useState('');
  const [viewerMacros, setViewerMacros] = useState<Record<string, any[]>>({});
  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const [appConfig] = useAppConfig();
  const navigate = useNavigate();
  const location = useLocation();
  const [llmResult, setLlmResult] = useState<string | null>(null);
  const [hasProcessedPendingCommands, setHasProcessedPendingCommands] = useState(false);

  const handleSubmitRef = useRef<() => void>();
  const lastDetectionRef = useRef<typeof keywordDetection>(null);


  /**
   * runViewerCommandsSequence(commandsArray):
   *   - commandsArray: array of viewer‐style commands (e.g. change_layout, zoom_view, etc.)
   *   - Calls handleLLMCommandForViewer(cmd) one by one, awaiting each
   */
  const runViewerCommandsSequence = async (commandsArray: any[]): Promise<void> => {
    if (!Array.isArray(commandsArray)) {
      console.warn('runViewerCommandsSequence expects an array of commands.');
      return;
    }
    for (const cmd of commandsArray) {
      await handleLLMCommandForViewer(cmd);
      await delay(50);
    }
  };

  /**
   * If URL has pendingViewerCommands, wait until each viewport has at least one
   * display set, then fire runViewerCommandsSequence exactly once.
   */
  useEffect(() => {
    let cancelled = false;

    if (hasProcessedPendingCommands) {
      return;
    }

    const params = new URLSearchParams(location.search);
    const encoded = params.get('pendingViewerCommands');
    if (!encoded) {
      return;
    }

    let viewerSteps: any[];
    try {
      viewerSteps = JSON.parse(atob(encoded));
      if (!Array.isArray(viewerSteps) || viewerSteps.length === 0) {
        // If it’s invalid or empty, just remove the param and bail
        params.delete('pendingViewerCommands');
        navigate(
          { pathname: location.pathname, search: params.toString() },
          { replace: true }
        );
        return;
      }
    } catch (e) {
      console.error('Failed to parse pendingViewerCommands:', e);
      params.delete('pendingViewerCommands');
      navigate(
        { pathname: location.pathname, search: params.toString() },
        { replace: true }
      );
      return;
    }

    const timer = setTimeout(async () => {
      if (cancelled) {
        return;
      }
      await runViewerCommandsSequence(viewerSteps);
      if (!cancelled) {
        setHasProcessedPendingCommands(true);
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [location.search, hasProcessedPendingCommands, navigate]);



  const handleLLMCommandForViewer = async (command: any): Promise<void> => {
    if (!command || typeof command !== 'object') return;

    switch (command.command) {
      // ──────────────────────────────────────────────────────────────────────────
      // run_sequence: Ad hoc execution of inline steps array
      // Usage: { command: "run_sequence", steps: [ {...}, {...}, … ] }
      case 'run_sequence': {
        const { steps } = command as any;
        if (!Array.isArray(steps)) {
          console.warn('run_sequence expects a steps array.');
          break;
        }
        await runViewerCommandsSequence(steps);
        break;
      }
      // ──────────────────────────────────────────────────────────────────────────

      // ──────────────────────────────────────────────────────────────────────────
      // perform_macro: Only runs a previously defined named macro
      // Usage: { command: "perform_macro", macroName: "V1" }
      case 'perform_macro': {
        const { macroName } = command as any;
        if (typeof macroName !== 'string') {
          console.warn('perform_macro requires a macroName string.');
          break;
        }
        const namedSteps = viewerMacros[macroName];
        if (!Array.isArray(namedSteps)) {
          console.warn(`Viewer macro '${macroName}' not defined.`);
          break;
        }
        await runViewerCommandsSequence(namedSteps);
        break;
      }
      // ──────────────────────────────────────────────────────────────────────────

      // ──────────────────────────────────────────────────────────────────────────
      // define_macro for viewer: saves an array of steps under viewerMacros[macroName]
      case 'define_macro': {
        const { macroName, steps } = command as any;
        if (typeof macroName !== 'string' || !Array.isArray(steps)) {
          console.warn('define_macro requires a string macroName and an array of steps.');
          break;
        }
        setViewerMacros(prev => ({ ...prev, [macroName]: steps }));
        console.log(`Viewer macro '${macroName}' defined (${steps.length} steps).`);
        break;
      }

      case 'change_layout':
        const stageMap = {
          '1x1': '1x1',
          '2x1': '2x1',
          '2x2': '2x2',
          '3x1': '3x1',
        };
        const stageId = stageMap[command.layout];
        if (stageId) {
          commandsManager.runCommand('setHangingProtocol', {
            protocolId: '@ohif/mnGrid',
            stageId: stageId,
          });
          await delay(0);
        } else {
          console.warn('Unsupported layout:', command.layout);
        }
        break;

      case 'rotate_view': {
        const { direction, angle } = command;

        if (![90, 180, 270].includes(angle)) {
          console.warn('Invalid angle:', angle);
          return;
        }

        const rotateCommand = direction === 'right' ? 'rotateViewportCW' : 'rotateViewportCCW';

        const times = angle / 90;
        for (let i = 0; i < times; i++) {
          commandsManager.runCommand(rotateCommand, {
            context: 'CORNERSTONE',
          });
          await delay(0);
        }
        break;
      }

      case 'zoom_view': {
        const direction = command.direction === 'out' ? 'out' : 'in';
        const intensity = Number.isInteger(command.intensity) ? command.intensity : 1;
        const dx = Number(command.dx) || 0;
        const dy = Number(command.dy) || 0;

        commandsManager.runCommand('forceZoom', {
          direction,
          intensity,
          dx,
          dy,
        });
        await delay(0);
        break;
      }

      case 'play_cine': {
        const { cineService, viewportGridService } = servicesManager.services;
        const { activeViewportIndex } = viewportGridService.getState();
        cineService.setCine({ id: activeViewportIndex, isPlaying: true });
        await delay(0);
        break;
      }

      case 'stop_cine': {
        const { cineService, viewportGridService } = servicesManager.services;
        const { activeViewportIndex } = viewportGridService.getState();
        cineService.setCine({ id: activeViewportIndex, isPlaying: false });
        await delay(0);
        break;
      }

      case 'download_image':
        commandsManager.runCommand('downloadViewportImage');
        await delay(0);
        break;

      case 'pan_view':
        const { dx = 0, dy = 0 } = command;
        commandsManager.runCommand('panViewport', { dx, dy });
        await delay(0);
        break;

      case 'reset_view':
        commandsManager.runCommand('resetViewport');
        await delay(0);
        break;

      default:
        console.warn('Unknown LLM command:', command);
    }
  };
  // ────────────────────────────────────────────────────────────────────────────

  // ─── Recorder & Porcupine setup ─────────────────────────────────────────────
  const {
    recording,
    start: startRecording,
    stop: stopRecording,
    volume,
  } = useRecorder({
    onAutoStop: () => handleSubmitRef.current?.(),
  });

  const { keywordDetection, isLoaded, init, start, stop, release } = usePorcupine();

  // 1) One-time init / cleanup
  useEffect(() => {
    init(
      PICO_KEY,
      [{ base64: HEY_PACS_KEYWORD_BASE64, label: 'hey pacs' }],
      { base64: PORCUPINE_MODEL_BASE64 }
    ).catch(console.error);
    return () => release();
  }, [init, release]);

  // 2) Only listen *while* modal is closed
  useEffect(() => {
    if (!isLoaded) return;
    isVoiceDialogOpen ? stop() : start();
  }, [isLoaded, isVoiceDialogOpen, start, stop]);

  // 3) React once per new detection
  useEffect(() => {
    if (!isLoaded || isVoiceDialogOpen) return;
    if (
      keywordDetection &&
      keywordDetection !== lastDetectionRef.current
    ) {
      lastDetectionRef.current = keywordDetection;
      startRecording();
      setIsVoiceDialogOpen(true);
    }
  }, [
    keywordDetection,
    isLoaded,
    isVoiceDialogOpen,
    startRecording,
  ]);

  // 4) Submit handler
  const handleSubmitVoiceInput = useCallback(async () => {
    const recordedBlob = await stopRecording(); // sets `recording = false` immediately
    let text = voiceInput.trim();

    if (!text) {
      if (!recordedBlob) {
        alert("녹음 중 오류가 발생했습니다.");
        return;
      }
      text = await transcribeAudio(recordedBlob);
      setVoiceInput(text);
      if (/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(text)) {
        text = await translateToEnglish(text);
      }
    }
    const result = await sendPromptToLLM(text, 'viewer');
    if (result) {
      setLlmResult(JSON.stringify(result));
      handleLLMCommandForViewer(result);
    }
    setVoiceInput('');
    setIsVoiceDialogOpen(false);
  }, [
    stopRecording,
    voiceInput,
    handleLLMCommandForViewer,
  ]);

  // 5) Keep ref fresh
  useEffect(() => {
    handleSubmitRef.current = handleSubmitVoiceInput;
  }, [handleSubmitVoiceInput]);

  const handleVoiceCommandClick = () => {
    startRecording();
    setIsVoiceDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsVoiceDialogOpen(false);
  };


  const onClickReturnButton = () => {
    const { pathname } = location;
    const dataSourceIdx = pathname.indexOf('/', 1);
    // const search =
    //   dataSourceIdx === -1
    //     ? undefined
    //     : `datasources=${pathname.substring(dataSourceIdx + 1)}`;

    // Todo: Handle parameters in a better way.
    const query = new URLSearchParams(window.location.search);
    const configUrl = query.get('configUrl');

    const searchQuery = new URLSearchParams();
    if (dataSourceIdx !== -1) {
      searchQuery.append('datasources', pathname.substring(dataSourceIdx + 1));
    }

    if (configUrl) {
      searchQuery.append('configUrl', configUrl);
    }

    navigate({
      pathname: '/',
      search: decodeURIComponent(searchQuery.toString()),
    });
  };

  const { t } = useTranslation();
  const { show, hide } = useModal();

  const [showLoadingIndicator, setShowLoadingIndicator] = useState(
    appConfig.showLoadingIndicator
  );

  const { hangingProtocolService } = servicesManager.services;

  const { hotkeyDefinitions, hotkeyDefaults } = hotkeysManager;
  const versionNumber = process.env.VERSION_NUMBER;
  const commitHash = process.env.COMMIT_HASH;

  const menuOptions = [
    {
      title: t('Header:About'),
      icon: 'info',
      onClick: () =>
        show({
          content: AboutModal,
          title: 'About OHIF Viewer',
          contentProps: { versionNumber, commitHash },
        }),
    },
    {
      title: t('Header:Preferences'),
      icon: 'settings',
      onClick: () =>
        show({
          title: t('UserPreferencesModal:User Preferences'),
          content: UserPreferences,
          contentProps: {
            hotkeyDefaults: hotkeysManager.getValidHotkeyDefinitions(
              hotkeyDefaults
            ),
            hotkeyDefinitions,
            currentLanguage: currentLanguage(),
            availableLanguages,
            defaultLanguage,
            onCancel: () => {
              hotkeys.stopRecord();
              hotkeys.unpause();
              hide();
            },
            onSubmit: ({ hotkeyDefinitions, language }) => {
              i18n.changeLanguage(language.value);
              hotkeysManager.setHotkeys(hotkeyDefinitions);
              hide();
            },
            onReset: () => hotkeysManager.restoreDefaultBindings(),
            hotkeysModule: hotkeys,
          },
        }),
    },
  ];

  if (appConfig.oidc) {
    menuOptions.push({
      title: t('Header:Logout'),
      icon: 'power-off',
      onClick: async () => {
        navigate(
          `/logout?redirect_uri=${encodeURIComponent(window.location.href)}`
        );
      },
    });
  }

  /**
   * Set body classes (tailwindcss) that don't allow vertical
   * or horizontal overflow (no scrolling). Also guarantee window
   * is sized to our viewport.
   */
  useEffect(() => {
    document.body.classList.add('bg-black');
    document.body.classList.add('overflow-hidden');
    return () => {
      document.body.classList.remove('bg-black');
      document.body.classList.remove('overflow-hidden');
    };
  }, []);

  const getComponent = id => {
    const entry = extensionManager.getModuleEntry(id);

    if (!entry) {
      throw new Error(
        `${id} is not a valid entry for an extension module, please check your configuration or make sure the extension is registered.`
      );
    }

    let content;
    if (entry && entry.component) {
      content = entry.component;
    } else {
      throw new Error(
        `No component found from extension ${id}. Check the reference string to the extension in your Mode configuration`
      );
    }

    return { entry, content };
  };

  const getPanelData = id => {
    const { content, entry } = getComponent(id);

    return {
      id: entry.id,
      iconName: entry.iconName,
      iconLabel: entry.iconLabel,
      label: entry.label,
      name: entry.name,
      content,
    };
  };

  useEffect(() => {
    const { unsubscribe } = hangingProtocolService.subscribe(
      HangingProtocolService.EVENTS.PROTOCOL_CHANGED,

      // Todo: right now to set the loading indicator to false, we need to wait for the
      // hangingProtocolService to finish applying the viewport matching to each viewport,
      // however, this might not be the only approach to set the loading indicator to false. we need to explore this further.
      () => {
        setShowLoadingIndicator(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [hangingProtocolService]);

  const getViewportComponentData = viewportComponent => {
    const { entry } = getComponent(viewportComponent.namespace);

    return {
      component: entry.component,
      displaySetsToDisplay: viewportComponent.displaySetsToDisplay,
    };
  };

  const leftPanelComponents = leftPanels.map(getPanelData);
  const rightPanelComponents = rightPanels.map(getPanelData);
  const viewportComponents = viewports.map(getViewportComponentData);

  return (
    <div>
      <Header
        menuOptions={menuOptions}
        isReturnEnabled={!!appConfig.showStudyList}
        onClickReturnButton={onClickReturnButton}
        onVoiceCommandClick={handleVoiceCommandClick}
        WhiteLabeling={appConfig.whiteLabeling}
      >
        <ErrorBoundary context="Primary Toolbar">
          <div className="relative flex justify-center">
            <Toolbar servicesManager={servicesManager} />
          </div>
        </ErrorBoundary>
      </Header>
      {llmResult && (
        <div className="p-4 bg-gray-800 text-white">
          <strong>LLM 결과:</strong> {llmResult}
        </div>
      )}
      {isVoiceDialogOpen && (
        <Modal
          isOpen
          onClose={() => setIsVoiceDialogOpen(false)}
          title="Voice Command"
          closeButton
        >
          <div className="p-4">
            <p className="text-center mb-2">
              {recording ? '🔴 녹음 중…' : '🔈 처리 중…'}
            </p>
            <div className="my-2 text-center text-sm text-gray-400">
              <p>Mic Volume: {volume.toFixed(2)}</p>
              <progress className="w-full" max="100" value={volume}></progress>
            </div>
            <textarea
              className="w-full p-2 border rounded text-black"
              rows={4}
              placeholder={t('VoiceCommand:placeholder', 'Type your voice command here...')}
              value={voiceInput}
              onChange={(e) => setVoiceInput(e.target.value)}
            />
            <div className="flex justify-end">
              <button
                className="px-4 py-2 bg-primary-main text-white rounded"
                onClick={handleSubmitVoiceInput}
              >
                Submit
              </button>
              <button
                className="ml-2 px-4 py-2 bg-gray-300 rounded"
                onClick={() => setIsVoiceDialogOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
      <div
        className="bg-black flex flex-row items-stretch w-full overflow-hidden flex-nowrap relative"
        style={{ height: 'calc(100vh - 52px' }}
      >
        <React.Fragment>
          {showLoadingIndicator && (
            <LoadingIndicatorProgress className="h-full w-full bg-black" />
          )}
          {/* LEFT SIDEPANELS */}
          {leftPanelComponents.length ? (
            <ErrorBoundary context="Left Panel">
              <SidePanel
                side="left"
                activeTabIndex={leftPanelDefaultClosed ? null : 0}
                tabs={leftPanelComponents}
                servicesManager={servicesManager}
              />
            </ErrorBoundary>
          ) : null}
          {/* TOOLBAR + GRID */}
          <div className="flex flex-col flex-1 h-full">
            <div className="flex items-center justify-center flex-1 h-full overflow-hidden bg-black relative">
              <ErrorBoundary context="Grid">
                <ViewportGridComp
                  servicesManager={servicesManager}
                  viewportComponents={viewportComponents}
                  commandsManager={commandsManager}
                />
              </ErrorBoundary>
            </div>
          </div>
          {rightPanelComponents.length ? (
            <ErrorBoundary context="Right Panel">
              <SidePanel
                side="right"
                activeTabIndex={rightPanelDefaultClosed ? null : 0}
                tabs={rightPanelComponents}
                servicesManager={servicesManager}
              />
            </ErrorBoundary>
          ) : null}
        </React.Fragment>
      </div>
    </div>
  );
}

ViewerLayout.propTypes = {
  // From extension module params
  extensionManager: PropTypes.shape({
    getModuleEntry: PropTypes.func.isRequired,
  }).isRequired,
  commandsManager: PropTypes.instanceOf(CommandsManager),
  servicesManager: PropTypes.instanceOf(ServicesManager),
  // From modes
  leftPanels: PropTypes.array,
  rightPanels: PropTypes.array,
  leftPanelDefaultClosed: PropTypes.bool.isRequired,
  rightPanelDefaultClosed: PropTypes.bool.isRequired,
  /** Responsible for rendering our grid of viewports; provided by consuming application */
  children: PropTypes.oneOfType([PropTypes.node, PropTypes.func]).isRequired,
};

export default ViewerLayout;

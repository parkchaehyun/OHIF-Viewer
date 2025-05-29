import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { sendPromptToLLM, transcribeAudio, translateToEnglish } from '../../../../platform/app/src/routes/WorkList/llmService';
import { useRecorder } from '../../../../platform/app/src/routes/WorkList/useRecorder';

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

  const [appConfig] = useAppConfig();
  const navigate = useNavigate();
  const location = useLocation();
  const [llmResult, setLlmResult] = useState<string | null>(null);

  const {
    recording,
    audioBlob,
    start: startRecording,
    stop: stopRecording,
  } = useRecorder();

  const handleVoiceCommandClick = () => {
    startRecording();
    setIsVoiceDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsVoiceDialogOpen(false);
  };

  const handleLLMCommandForViewer = (command: any) => {
    if (!command || typeof command !== 'object') return;

    switch (command.command) {
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
        break;
      }

      case 'play_cine': {
        const { cineService, viewportGridService } = servicesManager.services;
        const { activeViewportIndex } = viewportGridService.getState();
        cineService.setCine({ id: activeViewportIndex, isPlaying: true });
        break;
      }

      case 'stop_cine': {
        const { cineService, viewportGridService } = servicesManager.services;
        const { activeViewportIndex } = viewportGridService.getState();
        cineService.setCine({ id: activeViewportIndex, isPlaying: false });
        break;
      }

      case 'download_image':
        commandsManager.runCommand('downloadViewportImage');
        break;

      case 'pan_view':
        const { dx = 0, dy = 0 } = command;
        commandsManager.runCommand('panViewport', { dx, dy });
        break;

      case 'reset_view':
        commandsManager.runCommand('resetViewport');
        break;

      default:
        console.warn('Unknown LLM command:', command);
    }
  };

  const handleSubmitVoiceInput = async () => {
    let text = voiceInput.trim();

    if (text) {

    } else {
      const recordedBlob = await stopRecording();
      if (!recordedBlob) {
        alert("녹음 중 오류가 발생했습니다.");
        return;
      }
      try {
        text = await transcribeAudio(recordedBlob);
      } catch (e) {
        console.error("STT 실패:", e);
        alert("음성 인식에 실패했습니다.");
        return;
      }
    }

    if (/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(text)) {
      try {
        text = await translateToEnglish(text);
      } catch (e) {
        console.error("번역 실패:", e);
        alert("번역에 실패했습니다.");
        return;
      }
    }

    const result = await sendPromptToLLM(text, "viewer");

    if (result) {
      setLlmResult(JSON.stringify(result));
      handleLLMCommandForViewer(result);
    } else {
      setLlmResult("응답 실패");
    }

    setVoiceInput("");
    handleCloseDialog();
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
          isOpen={isVoiceDialogOpen}
          onClose={handleCloseDialog}
          title="Voice Command"
          closeButton
        >
          <div className="p-4">
            <p className="mb-2 text-center">
              {recording ? '🔴 녹음 중...' : '🔈 대기 중...'}
            </p>
            <textarea
              className="w-full p-2 border rounded text-black"
              rows={4}
              placeholder="Type your voice command here..."
              value={voiceInput}
              onChange={(e) => setVoiceInput(e.target.value)}
            />
            <div className="mt-4 flex justify-end">
              <button
                className="px-4 py-2 bg-primary-main text-white rounded"
                onClick={handleSubmitVoiceInput}
              >
                Submit
              </button>
              <button
                className="ml-2 px-4 py-2 bg-gray-300 rounded"
                onClick={handleCloseDialog}
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

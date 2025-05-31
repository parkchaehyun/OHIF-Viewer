import React, { useState, useEffect } from 'react';
import classnames from 'classnames';
import PropTypes from 'prop-types';
import { Link, useNavigate } from 'react-router-dom';
import moment from 'moment';
import qs from 'query-string';
import isEqual from 'lodash.isequal';
import { useTranslation } from 'react-i18next';
//
import filtersMeta from './filtersMeta.js';
import { useAppConfig } from '@state';
import { useDebounce, useSearchParams } from '@hooks';
import { utils, hotkeys, ServicesManager } from '@ohif/core';
import { useRecorder } from './useRecorder';

import {
  Icon,
  StudyListExpandedRow,
  Button,
  EmptyStudies,
  StudyListTable,
  StudyListPagination,
  StudyListFilter,
  TooltipClipboard,
  Header,
  useModal,
  AboutModal,
  UserPreferences,
  LoadingIndicatorProgress,
  Modal,
} from '@ohif/ui';

import i18n from '@ohif/i18n';

import { sendPromptToLLM, transcribeAudio, translateToEnglish } from './llmService'; //llm연결

const { sortBySeriesDate } = utils;

const { availableLanguages, defaultLanguage, currentLanguage } = i18n;

const seriesInStudiesMap = new Map();

/**
 * TODO:
 * - debounce `setFilterValues` (150ms?)
 */
function WorkList({
  data: studies,
  dataTotal: studiesTotal,
  isLoadingData,
  dataSource,
  hotkeysManager,
  dataPath,
  onRefresh,
  servicesManager,
}) {
  // WorkList.tsx 상단(함수 컴포넌트 내부)에 useState를 import한 상태에서:
  const [llmResult, setLlmResult] = useState<string | null>(null);
  const { hotkeyDefinitions, hotkeyDefaults } = hotkeysManager;
  const { show, hide } = useModal();
  const { t } = useTranslation();
  const {
    recording,
    audioBlob,
    start: startRecording,
    stop: stopRecording,
  } = useRecorder();

  // ~ Modes
  const [appConfig] = useAppConfig();
  // ~ Filters
  const searchParams = useSearchParams();
  const navigate = useNavigate();
  const STUDIES_LIMIT = 101;
  const queryFilterValues = _getQueryFilterValues(searchParams);
  const [filterValues, _setFilterValues] = useState({
    ...defaultFilterValues,
    ...queryFilterValues,
  });
  function applyLLMFilters(parsedResult) {
    const newFilters = { ...filterValues };

    if (parsedResult.patientName) {
      newFilters.patientName = parsedResult.patientName;
    }
    if (parsedResult.description) {
      newFilters.description = parsedResult.description;
    }
    if (parsedResult.modalities) {
      newFilters.modalities = parsedResult.modalities;
    }
    if (parsedResult.studyDateRange) {
      newFilters.studyDate = {
        startDate: parsedResult.studyDateRange[0],
        endDate: parsedResult.studyDateRange[1],
      };
    }

    setFilterValues(newFilters);
    onRefresh();
  }

  function handleLLMCommand(command: any) {
    if (!command || typeof command !== 'object') return;

    switch (command.command) {
      case 'filter':
        applyLLMFilters(command);
        break;

      case 'go_to_page':
        if (typeof command.pageNumber === 'number') {
          setFilterValues(prev => ({ ...prev, pageNumber: command.pageNumber }));
        }
        break;

      case 'sort':
        if (command.sortBy && command.sortDirection) {
          setFilterValues(prev => ({
            ...prev,
            sortBy: command.sortBy,
            sortDirection: command.sortDirection,
          }));
        }
        break;

      case 'clear_filters':
        setFilterValues(defaultFilterValues);
        break;

      case 'open_study':
        if (command.studyInstanceUid) {
          const query = new URLSearchParams({ StudyInstanceUIDs: command.studyInstanceUid });
          navigate(`/viewer/dicomweb?${query.toString()}`);
        }
        break;

      case 'show_version':
        alert(`버전 정보: ${process.env.VERSION_NUMBER} / ${process.env.COMMIT_HASH}`);
        break;

      case 'open_upload':
        if (uploadProps) {
          show(uploadProps);
        }
        break;

      case 'delete_exam':
        alert(`삭제 요청됨: ${command.studyInstanceUid}`);
        break;

      case 'error':
        if (command.message) {
          alert(`LLM 오류 응답: ${command.message}`);
        }
        break;

      default:
        console.warn('알 수 없는 명령:', command);
    }
  }


  // ~ Voice Command Dialog State
  const [isVoiceDialogOpen, setIsVoiceDialogOpen] = useState(false);
  const [voiceInput, setVoiceInput] = useState('');

  // Voice command handlers
  const handleVoiceCommandClick = () => {
    startRecording();
    setIsVoiceDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsVoiceDialogOpen(false);
  };
  const start = (filterValues.pageNumber - 1) * filterValues.resultsPerPage;
  const currentPageStudies = studies.slice(start, start + filterValues.resultsPerPage);
  const handleSubmitVoiceInput = async () => {
    const recordedBlob = await stopRecording();

    let text = voiceInput.trim();
    if (!text) {
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
      if (/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(text)) {
        try {
          text = await translateToEnglish(text);
        } catch (e) {
          console.error("번역 실패:", e);
          alert("번역에 실패했습니다.");
          return;
        }
      }
    }

    let result = null;
    try {
      result = await sendPromptToLLM(
        text,
        "worklist",
        studies,
        currentPageStudies
      );
    } catch (e) {
      console.error("LLM 요청 실패:", e);
    }

    if (result) {
      setLlmResult(JSON.stringify(result));
      handleLLMCommand(result);
    } else {
      setLlmResult("응답 실패");
    }

    setVoiceInput("");
    handleCloseDialog();
  };

  const debouncedFilterValues = useDebounce(filterValues, 200);
  const { resultsPerPage, pageNumber, sortBy, sortDirection } = filterValues;

  /*
   * The default sort value keep the filters synchronized with runtime conditional sorting
   * Only applied if no other sorting is specified and there are less than 101 studies
   */

  const canSort = studiesTotal < STUDIES_LIMIT;
  const shouldUseDefaultSort = sortBy === '' || !sortBy;
  const sortModifier = sortDirection === 'descending' ? 1 : -1;
  const defaultSortValues =
    shouldUseDefaultSort && canSort
      ? { sortBy: 'studyDate', sortDirection: 'ascending' }
      : {};
  const sortedStudies = studies;

  if (canSort) {
    studies.sort((s1, s2) => {
      if (shouldUseDefaultSort) {
        const ascendingSortModifier = -1;
        return _sortStringDates(s1, s2, ascendingSortModifier);
      }

      const s1Prop = s1[sortBy];
      const s2Prop = s2[sortBy];

      if (typeof s1Prop === 'string' && typeof s2Prop === 'string') {
        return s1Prop.localeCompare(s2Prop) * sortModifier;
      } else if (typeof s1Prop === 'number' && typeof s2Prop === 'number') {
        return (s1Prop > s2Prop ? 1 : -1) * sortModifier;
      } else if (!s1Prop && s2Prop) {
        return -1 * sortModifier;
      } else if (!s2Prop && s1Prop) {
        return 1 * sortModifier;
      } else if (sortBy === 'studyDate') {
        return _sortStringDates(s1, s2, sortModifier);
      }

      return 0;
    });
  }

  // ~ Rows & Studies
  const [expandedRows, setExpandedRows] = useState([]);
  const [studiesWithSeriesData, setStudiesWithSeriesData] = useState([]);
  const numOfStudies = studiesTotal;

  const setFilterValues = updater => {
    const newVal = typeof updater === 'function' ? updater(filterValues) : updater;

    if (filterValues.pageNumber === newVal.pageNumber) {
      newVal.pageNumber = 1;
    }

    _setFilterValues(newVal);
    setExpandedRows([]);
  };


  const onPageNumberChange = newPageNumber => {
    const oldPageNumber = filterValues.pageNumber;
    const rollingPageNumberMod = Math.floor(101 / filterValues.resultsPerPage);
    const rollingPageNumber = oldPageNumber % rollingPageNumberMod;
    const isNextPage = newPageNumber > oldPageNumber;
    const hasNextPage =
      Math.max(rollingPageNumber, 1) * resultsPerPage < numOfStudies;

    if (isNextPage && !hasNextPage) {
      return;
    }

    setFilterValues({ ...filterValues, pageNumber: newPageNumber });
  };

  const onResultsPerPageChange = newResultsPerPage => {
    setFilterValues({
      ...filterValues,
      pageNumber: 1,
      resultsPerPage: Number(newResultsPerPage),
    });
  };

  // Set body style
  useEffect(() => {
    document.body.classList.add('bg-black');
    return () => {
      document.body.classList.remove('bg-black');
    };
  }, []);

  // Sync URL query parameters with filters
  useEffect(() => {
    if (!debouncedFilterValues) {
      return;
    }

    const queryString = {};
    Object.keys(defaultFilterValues).forEach(key => {
      const defaultValue = defaultFilterValues[key];
      const currValue = debouncedFilterValues[key];

      // TODO: nesting/recursion?
      if (key === 'studyDate') {
        if (
          currValue.startDate &&
          defaultValue.startDate !== currValue.startDate
        ) {
          queryString.startDate = currValue.startDate;
        }
        if (currValue.endDate && defaultValue.endDate !== currValue.endDate) {
          queryString.endDate = currValue.endDate;
        }
      } else if (key === 'modalities' && currValue.length) {
        queryString.modalities = currValue.join(',');
      } else if (currValue !== defaultValue) {
        queryString[key] = currValue;
      }
    });

    const search = qs.stringify(queryString, {
      skipNull: true,
      skipEmptyString: true,
    });

    navigate({
      pathname: '/',
      search: search ? `?${search}` : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedFilterValues]);

  // Query for series information
  useEffect(() => {
    const fetchSeries = async studyInstanceUid => {
      try {
        const series = await dataSource.query.series.search(studyInstanceUid);
        seriesInStudiesMap.set(studyInstanceUid, sortBySeriesDate(series));
        setStudiesWithSeriesData([...studiesWithSeriesData, studyInstanceUid]);
      } catch (ex) {
        // TODO: UI Notification Service
        console.warn(ex);
      }
    };

    // TODO: WHY WOULD YOU USE AN INDEX OF 1?!
    // Note: expanded rows index begins at 1
    for (let z = 0; z < expandedRows.length; z++) {
      const expandedRowIndex = expandedRows[z] - 1;
      const studyInstanceUid = sortedStudies[expandedRowIndex].studyInstanceUid;

      if (studiesWithSeriesData.includes(studyInstanceUid)) {
        continue;
      }

      fetchSeries(studyInstanceUid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedRows, studies]);

  const isFiltering = (filterValues, defaultFilterValues) => {
    return !isEqual(filterValues, defaultFilterValues);
  };

  const rollingPageNumberMod = Math.floor(101 / resultsPerPage);
  const rollingPageNumber = (pageNumber - 1) % rollingPageNumberMod;
  const offset = resultsPerPage * rollingPageNumber;
  const offsetAndTake = offset + resultsPerPage;
  const tableDataSource = sortedStudies.map((study, key) => {
    const rowKey = key + 1;
    const isExpanded = expandedRows.some(k => k === rowKey);
    const {
      studyInstanceUid,
      accession,
      modalities,
      instances,
      description,
      mrn,
      patientName,
      date,
      time,
    } = study;
    const studyDate =
      date &&
      moment(date, ['YYYYMMDD', 'YYYY.MM.DD'], true).isValid() &&
      moment(date, ['YYYYMMDD', 'YYYY.MM.DD']).format('MMM-DD-YYYY');
    const studyTime =
      time &&
      moment(time, ['HH', 'HHmm', 'HHmmss', 'HHmmss.SSS']).isValid() &&
      moment(time, ['HH', 'HHmm', 'HHmmss', 'HHmmss.SSS']).format('hh:mm A');

    return {
      row: [
        {
          key: 'patientName',
          content: patientName ? (
            <TooltipClipboard>{patientName}</TooltipClipboard>
          ) : (
            <span className="text-gray-700">(Empty)</span>
          ),
          gridCol: 4,
        },
        {
          key: 'mrn',
          content: <TooltipClipboard>{mrn}</TooltipClipboard>,
          gridCol: 3,
        },
        {
          key: 'studyDate',
          content: (
            <>
              {studyDate && <span className="mr-4">{studyDate}</span>}
              {studyTime && <span>{studyTime}</span>}
            </>
          ),
          title: `${studyDate || ''} ${studyTime || ''}`,
          gridCol: 5,
        },
        {
          key: 'description',
          content: <TooltipClipboard>{description}</TooltipClipboard>,
          gridCol: 4,
        },
        {
          key: 'modality',
          content: modalities,
          title: modalities,
          gridCol: 3,
        },
        {
          key: 'accession',
          content: <TooltipClipboard>{accession}</TooltipClipboard>,
          gridCol: 3,
        },
        {
          key: 'instances',
          content: (
            <>
              <Icon
                name="group-layers"
                className={classnames('inline-flex mr-2 w-4', {
                  'text-primary-active': isExpanded,
                  'text-secondary-light': !isExpanded,
                })}
              />
              {instances}
            </>
          ),
          title: (instances || 0).toString(),
          gridCol: 4,
        },
      ],
      // Todo: This is actually running for all rows, even if they are
      // not clicked on.
      expandedContent: (
        <StudyListExpandedRow
          seriesTableColumns={{
            description: 'Description',
            seriesNumber: 'Series',
            modality: 'Modality',
            instances: 'Instances',
          }}
          seriesTableDataSource={
            seriesInStudiesMap.has(studyInstanceUid)
              ? seriesInStudiesMap.get(studyInstanceUid).map(s => {
                return {
                  description: s.description || '(empty)',
                  seriesNumber: s.seriesNumber ?? '',
                  modality: s.modality || '',
                  instances: s.numSeriesInstances || '',
                };
              })
              : []
          }
        >
          {appConfig.loadedModes.map((mode, i) => {
            const isFirst = i === 0;

            const modalitiesToCheck = modalities.replaceAll('/', '\\');

            const isValidMode = mode.isValidMode({
              modalities: modalitiesToCheck,
              study,
            });
            // TODO: Modes need a default/target route? We mostly support a single one for now.
            // We should also be using the route path, but currently are not
            // mode.routeName
            // mode.routes[x].path
            // Don't specify default data source, and it should just be picked up... (this may not currently be the case)
            // How do we know which params to pass? Today, it's just StudyInstanceUIDs and configUrl if exists
            const query = new URLSearchParams();
            if (filterValues.configUrl) {
              query.append('configUrl', filterValues.configUrl);
            }
            query.append('StudyInstanceUIDs', studyInstanceUid);
            return (
              <Link
                key={i}
                to={`${dataPath ? '../../' : ''}${mode.routeName}${dataPath ||
                  ''}?${query.toString()}`}
              // to={`${mode.routeName}/dicomweb?StudyInstanceUIDs=${studyInstanceUid}`}
              >
                <Button
                  rounded="full"
                  variant={isValidMode ? 'contained' : 'disabled'}
                  disabled={!isValidMode}
                  endIcon={<Icon name="launch-arrow" />} // launch-arrow | launch-info
                  className={classnames('font-medium   ', { 'ml-2': !isFirst })}
                  onClick={() => { }}
                >
                  {t(`Modes:${mode.displayName}`)}
                </Button>
              </Link>
            );
          })}
        </StudyListExpandedRow>
      ),
      onClickRow: () =>
        setExpandedRows(s =>
          isExpanded ? s.filter(n => rowKey !== n) : [...s, rowKey]
        ),
      isExpanded,
    };
  });

  const hasStudies = numOfStudies > 0;
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
            onCancel: hide,
            currentLanguage: currentLanguage(),
            availableLanguages,
            defaultLanguage,
            onSubmit: state => {
              i18n.changeLanguage(state.language.value);
              hotkeysManager.setHotkeys(state.hotkeyDefinitions);
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
      icon: 'power-off',
      title: t('Header:Logout'),
      onClick: () => {
        navigate(
          `/logout?redirect_uri=${encodeURIComponent(window.location.href)}`
        );
      },
    });
  }

  const { customizationService } = servicesManager.services;
  const { component: dicomUploadComponent } =
    customizationService.get('dicomUploadComponent') ?? {};
  const uploadProps =
    dicomUploadComponent && dataSource.getConfig().dicomUploadEnabled
      ? {
        title: 'Upload files',
        closeButton: true,
        shouldCloseOnEsc: false,
        shouldCloseOnOverlayClick: false,
        content: dicomUploadComponent.bind(null, {
          dataSource,
          onComplete: () => {
            hide();
            onRefresh();
          },
          onStarted: () => {
            show({
              ...uploadProps,
              // when upload starts, hide the default close button as closing the dialogue must be handled by the upload dialogue itself
              closeButton: false,
            });
          },
        }),
      }
      : undefined;

  return (
    <div className="bg-black h-screen flex flex-col ">
      <Header
        isSticky
        menuOptions={menuOptions}
        isReturnEnabled={false}
        WhiteLabeling={appConfig.whiteLabeling}
        onVoiceCommandClick={handleVoiceCommandClick} // Pass the handler
      />
      {/* 여기에 LLM 결과를 표시하는 새로운 영역을 추가 */}
      {llmResult && (
        <div className="p-4 bg-gray-800 text-white">
          <strong>LLM 결과:</strong> {llmResult}
        </div>
      )}

      <div className="overflow-y-auto ohif-scrollbar flex flex-col grow">
        <StudyListFilter
          numOfStudies={pageNumber * resultsPerPage > 100 ? 101 : numOfStudies}
          filtersMeta={filtersMeta}
          filterValues={{ ...filterValues, ...defaultSortValues }}
          onChange={setFilterValues}
          clearFilters={() => setFilterValues(defaultFilterValues)}
          isFiltering={isFiltering(filterValues, defaultFilterValues)}
          onUploadClick={uploadProps ? () => show(uploadProps) : undefined}
        />
        {hasStudies ? (
          <div className="grow flex flex-col">
            <StudyListTable
              tableDataSource={tableDataSource.slice(offset, offsetAndTake)}
              numOfStudies={numOfStudies}
              filtersMeta={filtersMeta}
            />
            <div className="grow">
              <StudyListPagination
                onChangePage={onPageNumberChange}
                onChangePerPage={onResultsPerPageChange}
                currentPage={pageNumber}
                perPage={resultsPerPage}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center pt-48">
            {appConfig.showLoadingIndicator && isLoadingData ? (
              <LoadingIndicatorProgress className={'w-full h-full bg-black'} />
            ) : (
              <EmptyStudies />
            )}
          </div>
        )}
        {/* Voice Command Dialog */}
        {isVoiceDialogOpen && (
          <Modal
            isOpen={isVoiceDialogOpen}
            onClose={handleCloseDialog}
            title={t('VoiceCommand:title', 'Voice Command')} // Optional: add to i18n
            closeButton
          >
            <div className="p-4">
              <p className="mb-2 text-center">
                {recording ? '🔴 녹음 중...' : '🔈 대기 중...'}
              </p>
              <textarea
                className="w-full p-2 border rounded text-black" // <-- add this class
                rows={4}
                placeholder={t('VoiceCommand:placeholder', 'Type your voice command here...')}
                value={voiceInput}
                onChange={(e) => setVoiceInput(e.target.value)}
              />
              <div className="mt-4 flex justify-end">
                <button
                  className="px-4 py-2 bg-primary-main text-white rounded"
                  onClick={handleSubmitVoiceInput}
                >
                  {t('VoiceCommand:submit', 'Submit')}
                </button>
                <button
                  className="ml-2 px-4 py-2 bg-gray-300 rounded"
                  onClick={handleCloseDialog}
                >
                  {t('VoiceCommand:cancel', 'Cancel')}
                </button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </div>
  );
}

WorkList.propTypes = {
  data: PropTypes.array.isRequired,
  dataSource: PropTypes.shape({
    query: PropTypes.object.isRequired,
    getConfig: PropTypes.func,
  }).isRequired,
  isLoadingData: PropTypes.bool.isRequired,
  servicesManager: PropTypes.instanceOf(ServicesManager),
};

const defaultFilterValues = {
  patientName: '',
  mrn: '',
  studyDate: {
    startDate: null,
    endDate: null,
  },
  description: '',
  modalities: [],
  accession: '',
  sortBy: '',
  sortDirection: 'none',
  pageNumber: 1,
  resultsPerPage: 25,
  datasources: '',
  configUrl: null,
};

function _tryParseInt(str, defaultValue) {
  let retValue = defaultValue;
  if (str && str.length > 0) {
    if (!isNaN(str)) {
      retValue = parseInt(str);
    }
  }
  return retValue;
}

function _getQueryFilterValues(params) {
  const queryFilterValues = {
    patientName: params.get('patientname'),
    mrn: params.get('mrn'),
    studyDate: {
      startDate: params.get('startdate') || null,
      endDate: params.get('enddate') || null,
    },
    description: params.get('description'),
    modalities: params.get('modalities')
      ? params.get('modalities').split(',')
      : [],
    accession: params.get('accession'),
    sortBy: params.get('sortby'),
    sortDirection: params.get('sortdirection'),
    pageNumber: _tryParseInt(params.get('pagenumber'), undefined),
    resultsPerPage: _tryParseInt(params.get('resultsperpage'), undefined),
    datasources: params.get('datasources'),
    configUrl: params.get('configurl'),
  };

  // Delete null/undefined keys
  Object.keys(queryFilterValues).forEach(
    key => queryFilterValues[key] == null && delete queryFilterValues[key]
  );

  return queryFilterValues;
}

function _sortStringDates(s1, s2, sortModifier) {
  // TODO: Delimiters are non-standard. Should we support them?
  const s1Date = moment(s1.date, ['YYYYMMDD', 'YYYY.MM.DD'], true);
  const s2Date = moment(s2.date, ['YYYYMMDD', 'YYYY.MM.DD'], true);

  if (s1Date.isValid() && s2Date.isValid()) {
    return (
      (s1Date.toISOString() > s2Date.toISOString() ? 1 : -1) * sortModifier
    );
  } else if (s1Date.isValid()) {
    return sortModifier;
  } else if (s2Date.isValid()) {
    return -1 * sortModifier;
  }
}

export default WorkList;

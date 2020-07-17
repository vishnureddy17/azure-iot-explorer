/***********************************************************
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License
 **********************************************************/
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import moment from 'moment';
import { Line } from 'react-chartjs-2';
import { CommandBar, ICommandBarItemProps } from 'office-ui-fabric-react/lib/components/CommandBar';
import { Label } from 'office-ui-fabric-react/lib/components/Label';
import { Spinner } from 'office-ui-fabric-react/lib/components/Spinner';
import { TextField, ITextFieldProps } from 'office-ui-fabric-react/lib/components/TextField';
import { Announced } from 'office-ui-fabric-react/lib/components/Announced';
import { IChoiceGroupOption, ChoiceGroup } from 'office-ui-fabric-react/lib/components/ChoiceGroup';
import { IDropdownOption, Dropdown } from 'office-ui-fabric-react/lib/components/Dropdown';
import { useLocation, useHistory } from 'react-router-dom';
import { ResourceKeys } from '../../../../../localization/resourceKeys';
import { monitorEvents, stopMonitoringEvents } from '../../../../api/services/devicesService';
import { Message, MESSAGE_SYSTEM_PROPERTIES, MESSAGE_PROPERTIES } from '../../../../api/models/messages';
import { parseDateTimeString } from '../../../../api/dataTransforms/transformHelper';
import { REFRESH, STOP, START, REMOVE, NAVIGATE_BACK } from '../../../../constants/iconNames';
import { ParsedJsonSchema } from '../../../../api/models/interfaceJsonParserOutput';
import { TelemetryContent } from '../../../../api/models/modelDefinition';
import { getInterfaceIdFromQueryString, getDeviceIdFromQueryString, getComponentNameFromQueryString } from '../../../../shared/utils/queryStringHelper';
import { SynchronizationStatus } from '../../../../api/models/synchronizationStatus';
import { DEFAULT_CONSUMER_GROUP } from '../../../../constants/apiConstants';
import { ErrorBoundary } from '../../../shared/components/errorBoundary';
import { getLocalizedData } from '../../../../api/dataTransforms/modelDefinitionTransform';
import { NotificationType } from '../../../../api/models/notification';
import { MultiLineShimmer } from '../../../../shared/components/multiLineShimmer';
import { LabelWithTooltip } from '../../../../shared/components/labelWithTooltip';
import { MILLISECONDS_IN_MINUTE } from '../../../../constants/shared';
import { appConfig, HostMode } from '../../../../../appConfig/appConfig';
import { SemanticUnit } from '../../../../shared/units/components/semanticUnit';
import { ROUTE_PARAMS } from '../../../../constants/routes';
import { raiseNotificationToast } from '../../../../notifications/components/notificationToast';
import { usePnpStateContext } from '../../../../shared/contexts/pnpStateContext';
import { getDeviceTelemetry, TelemetrySchema } from './dataHelper';
import { DEFAULT_COMPONENT_FOR_DIGITAL_TWIN } from '../../../../constants/devices';
import { getSchemaValidationErrors } from '../../../../shared/utils/jsonSchemaAdaptor';
import '../../../../css/_deviceEvents.scss';

const JSON_SPACES = 2;
const LOADING_LOCK = 50;
const MAX_CHART_POINTS = 50;
const TELEMETRY_SCHEMA_PROP = MESSAGE_PROPERTIES.IOTHUB_MESSAGE_SCHEMA;

export const DeviceEventsPerInterface: React.FC = () => {
    let timerID: any; // tslint:disable-line:no-any

    const { t } = useTranslation();
    const { search, pathname } = useLocation();
    const history = useHistory();
    const componentName = getComponentNameFromQueryString(search);
    const deviceId = getDeviceIdFromQueryString(search);
    const interfaceId = getInterfaceIdFromQueryString(search);

    const { pnpState, getModelDefinition } = usePnpStateContext();
    const modelDefinitionWithSource = pnpState.modelDefinitionWithSource.payload;
    const modelDefinition = modelDefinitionWithSource && modelDefinitionWithSource.modelDefinition;
    const isLoading = pnpState.modelDefinitionWithSource.synchronizationStatus === SynchronizationStatus.working;
    const telemetrySchema = React.useMemo(() => getDeviceTelemetry(modelDefinition), [modelDefinition]);

    const [ consumerGroup, setConsumerGroup] = React.useState(DEFAULT_CONSUMER_GROUP);
    const [ events, SetEvents] = React.useState([]);
    const [ startTime, SetStartTime] = React.useState(new Date(new Date().getTime() - MILLISECONDS_IN_MINUTE));
    const [ hasMore, setHasMore ] = React.useState(false);
    const [ dataToVisualize, setDataToVisualize ] = React.useState('');
    const [ loading, setLoading ] = React.useState(false);
    const [ loadingAnnounced, setLoadingAnnounced ] = React.useState(undefined);
    const [ monitoringData, setMonitoringData ] = React.useState(false);
    const [ synchronizationStatus, setSynchronizationStatus ] = React.useState(SynchronizationStatus.initialized);
    const [ showRawEvent, setShowRawEvent ] = React.useState(false);
    const [ showVisualization, setShowVisualization ] = React.useState(false);

    React.useEffect(() => {
        return () => {
            stopMonitoring();
        };
    },              []);

    const renderCommandBar = () => {
        return (
            <CommandBar
                className="command"
                items={[
                    createStartMonitoringCommandItem(),
                    createRefreshCommandItem(),
                    createClearCommandItem()
                ]}
                farItems={[createNavigateBackCommandItem()]}
            />
        );
    };

    const createClearCommandItem = (): ICommandBarItemProps => {
        return {
            ariaLabel: t(ResourceKeys.deviceEvents.command.clearEvents),
            disabled: events.length === 0 || synchronizationStatus === SynchronizationStatus.updating,
            iconProps: {iconName: REMOVE},
            key: REMOVE,
            name: t(ResourceKeys.deviceEvents.command.clearEvents),
            onClick: onClearData
        };
    };

    const createRefreshCommandItem = (): ICommandBarItemProps => {
        return {
            ariaLabel: t(ResourceKeys.deviceEvents.command.refresh),
            disabled: synchronizationStatus === SynchronizationStatus.updating,
            iconProps: {iconName: REFRESH},
            key: REFRESH,
            name: t(ResourceKeys.deviceEvents.command.refresh),
            onClick: getModelDefinition
        };
    };

    const createStartMonitoringCommandItem = (): ICommandBarItemProps => {
        if (appConfig.hostMode === HostMode.Electron) {
            const label = monitoringData ? t(ResourceKeys.deviceEvents.command.stop) : t(ResourceKeys.deviceEvents.command.start);
            const icon = monitoringData ? STOP : START;
            return {
                ariaLabel: label,
                disabled: synchronizationStatus === SynchronizationStatus.updating,
                iconProps: {
                    iconName: icon
                },
                key: icon,
                name: label,
                onClick: onToggleStart
            };
        }
        else {
            return {
                ariaLabel: t(ResourceKeys.deviceEvents.command.fetch),
                disabled: synchronizationStatus === SynchronizationStatus.updating || monitoringData,
                iconProps: {
                    iconName: START
                },
                key: START,
                name: t(ResourceKeys.deviceEvents.command.fetch),
                onClick: onToggleStart
            };
        }
    };

    const createNavigateBackCommandItem = (): ICommandBarItemProps => {
        return {
            ariaLabel: t(ResourceKeys.deviceEvents.command.close),
            iconProps: {iconName: NAVIGATE_BACK},
            key: NAVIGATE_BACK,
            name: t(ResourceKeys.deviceEvents.command.close),
            onClick: handleClose
        };
    };

    const consumerGroupChange = (event: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>, newValue?: string) => {
        if (!!newValue) {
            setConsumerGroup(newValue);
        }
    };

    const renderConsumerGroupLabel = () => (consumerGroupProps: ITextFieldProps) => {
        return (
            <LabelWithTooltip
                className={'consumer-group-label'}
                tooltipText={t(ResourceKeys.deviceEvents.consumerGroups.tooltip)}
            >
                {consumerGroupProps.label}
            </LabelWithTooltip>
        );
    };

    const renderTelemetryViewChoiceGroup = () => {
        /* make sure that these strings come from locale */
        const options: IChoiceGroupOption[] = [
            { key: 'parsedTelemetry', text: t(ResourceKeys.deviceEvents.telemetryViewChoiceGroup.parsedTelemetry) },
            { key: 'rawTelemetry', text: t(ResourceKeys.deviceEvents.telemetryViewChoiceGroup.rawTelemetry) },
            { key: 'visualization', text: t(ResourceKeys.deviceEvents.telemetryViewChoiceGroup.visualization) }
        ];
        return (
            <ChoiceGroup
                className="choice-group"
                defaultSelectedKey="parsedTelemetry"
                options={options}
                onChange={changeChoiceGroup}
                label={t(ResourceKeys.deviceEvents.telemetryViewChoiceGroup.label)}
                required={true}
            />
        );
    };

    const changeChoiceGroup = (event: React.FormEvent<HTMLInputElement>, option: IChoiceGroupOption) => {
        switch (option.key) {
            case 'parsedTelemetry':
                setShowRawEvent(false);
                setShowVisualization(false);
                break;
            case 'rawTelemetry':
                setShowRawEvent(true);
                setShowVisualization(false);
                break;
            case 'visualization':
                setShowVisualization(true);
                break;
            default:
                break;
        }
    };

    const stopMonitoring = async () => {
        clearTimeout(timerID);
        return stopMonitoringEvents();
    };

    const onToggleStart = () => {
        if (monitoringData) {
            stopMonitoring().then(() => {
                setHasMore(false);
                setMonitoringData(false);
                setSynchronizationStatus(SynchronizationStatus.fetched);
            });
            setHasMore(false);
            setSynchronizationStatus(SynchronizationStatus.updating);
        } else {
            setHasMore(true);
            setLoading(false);
            setLoadingAnnounced(undefined);
            setMonitoringData(true);
        }
    };

    const renderInfiniteScroll = () => {
        const InfiniteScroll = require('react-infinite-scroller'); // https://github.com/CassetteRocks/react-infinite-scroller/issues/110
        return (
            <InfiniteScroll
                key="scroll"
                className="device-events-container"
                pageStart={0}
                loadMore={fetchData()}
                hasMore={hasMore}
                loader={renderLoader()}
                isReverse={true}
            >
            {
                !showVisualization &&
                <section className="list-content">
                    {showRawEvent ? renderRawEvents() : renderEvents()}
                </section>
            }
            </InfiniteScroll>
        );
    };

    const renderRawEvents = () => {
        return (
            <div className="scrollable-pnp-telemetry">
            {
                events && events.map((event: Message, index) => {
                    return (
                        <article key={index} className="device-events-content">
                            {<h5>{parseDateTimeString(event.enqueuedTime)}:</h5>}
                            <pre>{JSON.stringify(event, undefined, JSON_SPACES)}</pre>
                        </article>
                    );
                })
            }
            </div>
        );
    };

    const renderEvents = () => {
        return (
            <div className="scrollable-pnp-telemetry">
                {
                    events && events.length > 0 &&
                    <>
                        <div className="pnp-detail-list">
                            <div className="list-header list-header-uncollapsible flex-grid-row">
                                <span className="col-sm2">{t(ResourceKeys.deviceEvents.columns.timestamp)}</span>
                                <span className="col-sm2">{t(ResourceKeys.deviceEvents.columns.displayName)}</span>
                                <span className="col-sm2">{t(ResourceKeys.deviceEvents.columns.schema)}</span>
                                <span className="col-sm2">{t(ResourceKeys.deviceEvents.columns.unit)}</span>
                                <span className="col-sm4">{t(ResourceKeys.deviceEvents.columns.value)}</span>
                            </div>
                        </div>
                        <section role="feed">
                        {
                            events.map((event: Message, index) => {
                                return !event.systemProperties ? renderEventsWithNoSystemProperties(event, index) :
                                    event.systemProperties[TELEMETRY_SCHEMA_PROP] ?
                                        renderEventsWithSchemaProperty(event, index) :
                                        renderEventsWithNoSchemaProperty(event, index);
                            })
                        }
                        </section>
                    </>
                }
            </div>
        );
    };

    const renderEventsWithSchemaProperty = (event: Message, index: number) => {
        const { telemetryModelDefinition, parsedSchema } = getModelDefinitionAndSchema(event.systemProperties[TELEMETRY_SCHEMA_PROP]);

        return (
            <article className="list-item event-list-item" role="article" key={index}>
                <section className="flex-grid-row item-summary">
                    <ErrorBoundary error={t(ResourceKeys.errorBoundary.text)}>
                        {renderTimestamp(event.enqueuedTime)}
                        {renderEventName(telemetryModelDefinition)}
                        {renderEventSchema(telemetryModelDefinition)}
                        {renderEventUnit(telemetryModelDefinition)}
                        {renderMessageBodyWithSchema(event.body, parsedSchema, event.systemProperties[TELEMETRY_SCHEMA_PROP])}
                    </ErrorBoundary>
                </section>
            </article>
        );
    };

    const renderEventsWithNoSchemaProperty = (event: Message, index: number) => {
        const telemetryKeys = Object.keys(event.body);
        if (telemetryKeys && telemetryKeys.length !== 0) {
            return telemetryKeys.map((key, keyIndex) => {
                const { telemetryModelDefinition, parsedSchema } = getModelDefinitionAndSchema(key);
                const partialEventBody: any = {}; // tslint:disable-line:no-any
                partialEventBody[key] = event.body[key];
                const isNotItemLast = keyIndex !== telemetryKeys.length - 1;

                return (
                    <article className="list-item event-list-item" role="article" key={key + index}>
                        <section className={`flex-grid-row item-summary ${isNotItemLast && 'item-summary-partial'}`}>
                            <ErrorBoundary error={t(ResourceKeys.errorBoundary.text)}>
                                {renderTimestamp(keyIndex === 0 ? event.enqueuedTime : null)}
                                {renderEventName(telemetryModelDefinition)}
                                {renderEventSchema(telemetryModelDefinition)}
                                {renderEventUnit(telemetryModelDefinition)}
                                {renderMessageBodyWithSchema(partialEventBody, parsedSchema, key)}
                            </ErrorBoundary>
                        </section>
                    </article>
                );
            });
        }
        return (
            <article className="list-item event-list-item" role="article" key={index}>
                <section className="flex-grid-row item-summary">
                    <ErrorBoundary error={t(ResourceKeys.errorBoundary.text)}>
                        {renderTimestamp(event.enqueuedTime)}
                        {renderEventName()}
                        {renderEventSchema()}
                        {renderEventUnit()}
                        {renderMessageBodyWithSchema(event.body, null, null)}
                    </ErrorBoundary>
                </section>
            </article>
        );
    };

    const renderEventsWithNoSystemProperties = (event: Message, index: number, ) => {
        return (
            <article className="list-item event-list-item" role="article" key={index}>
                <section className="flex-grid-row item-summary">
                    <ErrorBoundary error={t(ResourceKeys.errorBoundary.text)}>
                        {renderTimestamp(event.enqueuedTime)}
                        {renderEventName()}
                        {renderEventSchema()}
                        {renderEventUnit()}
                        {renderMessageBodyWithNoSchema(event.body)}
                    </ErrorBoundary>
                </section>
            </article>
        );
    };

    const renderTimestamp = (enqueuedTime: string) => {
        return(
            <div className="col-sm2">
                <Label aria-label={t(ResourceKeys.deviceEvents.columns.timestamp)}>
                    {enqueuedTime && parseDateTimeString(enqueuedTime)}
                </Label>
            </div>
        );
    };

    const renderEventName = (telemetryModelDefinition?: TelemetryContent) => {
        const displayName = telemetryModelDefinition ? getLocalizedData(telemetryModelDefinition.displayName) : '';
        return(
            <div className="col-sm2">
                <Label aria-label={t(ResourceKeys.deviceEvents.columns.displayName)}>
                    {telemetryModelDefinition ?
                        `${telemetryModelDefinition.name} (${displayName ? displayName : '--'})` : '--'}
                </Label>
            </div>
        );
    };

    const renderEventSchema = (telemetryModelDefinition?: TelemetryContent) => {
        return(
            <div className="col-sm2">
                <Label aria-label={t(ResourceKeys.deviceEvents.columns.schema)}>
                    {telemetryModelDefinition ?
                        (typeof telemetryModelDefinition.schema === 'string' ?
                        telemetryModelDefinition.schema :
                        telemetryModelDefinition.schema['@type']) : '--'}
                </Label>
            </div>
        );
    };

    const renderEventUnit = (telemetryModelDefinition?: TelemetryContent) => {
        return(
            <div className="col-sm2">
                <Label aria-label={t(ResourceKeys.deviceEvents.columns.unit)}>
                    <SemanticUnit unitHost={telemetryModelDefinition}/>
                </Label>
            </div>
        );
    };

    // tslint:disable-next-line: cyclomatic-complexity
    const renderMessageBodyWithSchema = (eventBody: any, schema: ParsedJsonSchema, key: string) => { // tslint:disable-line:no-any
        if (key && !schema) { // DTDL doesn't contain corresponding key
            const labelContent = t(ResourceKeys.deviceEvents.columns.validation.key.isNotSpecified, { key });
            return(
                <div className="column-value-text col-sm4">
                    <span aria-label={t(ResourceKeys.deviceEvents.columns.value)}>
                        {JSON.stringify(eventBody, undefined, JSON_SPACES)}
                        <Label className="value-validation-error">
                            {labelContent}
                        </Label>
                    </span>
                </div>
            );
        }

        if (eventBody && Object.keys(eventBody) && Object.keys(eventBody)[0] !== key) { // key in event body doesn't match property name
            const labelContent = Object.keys(eventBody)[0] ? t(ResourceKeys.deviceEvents.columns.validation.key.doesNotMatch, {
                expectedKey: key,
                receivedKey: Object.keys(eventBody)[0]
            }) : t(ResourceKeys.deviceEvents.columns.validation.value.bodyIsEmpty);
            return(
                <div className="column-value-text col-sm4">
                    <span aria-label={t(ResourceKeys.deviceEvents.columns.value)}>
                        {JSON.stringify(eventBody, undefined, JSON_SPACES)}
                        <Label className="value-validation-error">
                            {labelContent}
                        </Label>
                    </span>
                </div>
            );
        }

        return renderMessageBodyWithValueValidation(eventBody, schema, key);
    };

    const renderMessageBodyWithValueValidation = (eventBody: any, schema: ParsedJsonSchema, key: string) => { // tslint:disable-line:no-any
        const errors = getSchemaValidationErrors(eventBody[key], schema, true);

        return(
            <div className="column-value-text col-sm4">
                <Label aria-label={t(ResourceKeys.deviceEvents.columns.value)}>
                    {JSON.stringify(eventBody, undefined, JSON_SPACES)}
                    {errors.length !== 0 &&
                        <section className="value-validation-error" aria-label={t(ResourceKeys.deviceEvents.columns.validation.value.label)}>
                            <span>{t(ResourceKeys.deviceEvents.columns.validation.value.label)}</span>
                            <ul>
                            {errors.map((element, index) =>
                                <li key={index}>{element.message}</li>
                            )}
                            </ul>
                        </section>
                    }
                </Label>
            </div>
        );
    };

    const renderMessageBodyWithNoSchema = (eventBody: any) => { // tslint:disable-line:no-any
        return(
            <div className="column-value-text col-sm4">
                <Label aria-label={t(ResourceKeys.deviceEvents.columns.value)}>
                    {JSON.stringify(eventBody, undefined, JSON_SPACES)}
                </Label>
            </div>
        );
    };

    const renderLoader = (): JSX.Element => {
        return (
            <div key="custom-loader">
                <div className="events-loader">
                    <Spinner/>
                    <h4>{t(ResourceKeys.deviceEvents.infiniteScroll.loading)}</h4>
                </div>
            </div>
        );
    };

    const generateDropdownOptions = () => {
        return(
            Array.from(
                events.reduce<Set<string>>(
                    // tslint:disable-next-line: cyclomatic-complexity
                    (options: Set<string>, event: Message) => {
                        if (event.systemProperties && event.systemProperties[TELEMETRY_SCHEMA_PROP]) {
                            const matchingSchema = telemetrySchema.filter(schema => schema.telemetryModelDefinition.name === event.systemProperties[TELEMETRY_SCHEMA_PROP]);
                            const telemetryModelDefinition =  matchingSchema && matchingSchema.length !== 0 && matchingSchema[0].telemetryModelDefinition;
                            if (typeof telemetryModelDefinition.schema === 'string' && (telemetryModelDefinition.schema === 'double' ||
                            telemetryModelDefinition.schema === 'float' ||
                            telemetryModelDefinition.schema === 'integer' ||
                            telemetryModelDefinition.schema === 'long')) {
                                options.add(telemetryModelDefinition.name);
                            }
                        }
                        else if (event.systemProperties) {
                            const telemetryKeys = Object.keys(event.body);
                            if (telemetryKeys && telemetryKeys.length !== 0) {
                                for (const key of telemetryKeys) {
                                    const matchingSchema = telemetrySchema.filter(schema => schema.telemetryModelDefinition.name === key);
                                    const telemetryModelDefinition =  matchingSchema && matchingSchema.length !== 0 && matchingSchema[0].telemetryModelDefinition;
                                    if (typeof telemetryModelDefinition.schema === 'string' && (telemetryModelDefinition.schema === 'double' ||
                                    telemetryModelDefinition.schema === 'float' ||
                                    telemetryModelDefinition.schema === 'integer' ||
                                    telemetryModelDefinition.schema === 'long')) {
                                        options.add(telemetryModelDefinition.name);
                                    }
                                }
                            }
                        }
                        return options;
                    },
                    new Set<string>()
                )
            ).map(
                (option: string) => {
                    return({
                        key: option,
                        text: option
                    });
                }
            )
        );
    };

    const renderChart = () => {
        const data = events.reduce(
            (points, event: Message) => {
                if (event.body && event.body.hasOwnProperty(dataToVisualize) && points.labels.length < MAX_CHART_POINTS) {
                    points.datasets[0].data.push(Number(event.body[dataToVisualize]));
                    points.labels.push(moment(event.enqueuedTime).toDate());
                }
                return points;
            },
            {
                datasets: [{
                    backgroundColor: 'rgba(0, 116, 204, 1)',
                    data: [],
                    fill: false,
                    label: dataToVisualize,
                    lineTension: 0.1
                }],
                labels: []
            }
        );

        return (
            <div className="chart">
                <Line
                    data={data}
                    options={{
                        legend: {
                            display: false
                        },
                        maintainAspectRatio: false,
                        responsive: true,
                        scales: {
                            xAxes: [{
                                bounds: 'data',
                                display: true,
                                distribution: 'linear',
                                type: 'time'
                            }]
                        }
                    }}
                />
            </div>
        );
    };

    const filterMessage = (message: Message) => {
        if (!message || !message.systemProperties) {
            return false;
        }
        if (componentName === DEFAULT_COMPONENT_FOR_DIGITAL_TWIN) {
            // for default component, we only expect ${IOTHUB_INTERFACE_ID} to be in the system property not ${IOTHUB_COMPONENT_NAME}
            return message.systemProperties[MESSAGE_SYSTEM_PROPERTIES.IOTHUB_INTERFACE_ID] === interfaceId &&
                !message.systemProperties[MESSAGE_SYSTEM_PROPERTIES.IOTHUB_COMPONENT_NAME];
        }
        return message.systemProperties[MESSAGE_SYSTEM_PROPERTIES.IOTHUB_COMPONENT_NAME] === componentName;
    };

    const fetchData = () => () => {
        if (!loading && monitoringData) {
            setLoading(true);
            setLoadingAnnounced(<Announced message={t(ResourceKeys.deviceEvents.infiniteScroll.loading)}/>);
            timerID = setTimeout(
                () => {
                    monitorEvents({
                        consumerGroup,
                        deviceId,
                        fetchSystemProperties: true,
                        startTime
                    })
                    .then((results: Message[]) => {
                        const messages = results && results
                                .filter(result => filterMessage(result))
                                .reverse().map((message: Message) => message);
                        SetEvents([...messages, ...events]);
                        SetStartTime(new Date());
                        setLoading(false);
                        stopMonitoringIfNecessary();
                    })
                    .catch (error => {
                        raiseNotificationToast({
                            text: {
                                translationKey: ResourceKeys.deviceEvents.error,
                                translationOptions: {
                                    error
                                }
                            },
                            type: NotificationType.error
                        });
                        stopMonitoringIfNecessary();
                    });
                },
                LOADING_LOCK);
        }
    };

    const onClearData = () => {
        SetEvents([]);
    };

    const stopMonitoringIfNecessary = () => {
        if (appConfig.hostMode === HostMode.Electron) {
            return;
        }
        else {
            stopMonitoring().then(() => {
                setHasMore(false);
                setMonitoringData(false);
                setSynchronizationStatus(SynchronizationStatus.fetched);
            });
        }
    };

    const handleClose = () => {
        const path = pathname.replace(/\/ioTPlugAndPlayDetail\/events\/.*/, ``);
        history.push(`${path}/?${ROUTE_PARAMS.DEVICE_ID}=${encodeURIComponent(deviceId)}`);
    };

    const getModelDefinitionAndSchema = (key: string): TelemetrySchema => {
        const matchingSchema = telemetrySchema.filter(schema => schema.telemetryModelDefinition.name === key);
        const telemetryModelDefinition =  matchingSchema && matchingSchema.length !== 0 && matchingSchema[0].telemetryModelDefinition;
        const parsedSchema = matchingSchema && matchingSchema.length !== 0 && matchingSchema[0].parsedSchema;
        return {
            parsedSchema,
            telemetryModelDefinition
        };
    };

    const dataToVisualizeChange = (event: React.FormEvent<HTMLDivElement>, option?: IDropdownOption) => {
        if (typeof option.key === 'string') {
            setDataToVisualize(option.key);
        }
    };

    if (isLoading) {
        return <MultiLineShimmer/>;
    }

    return (
        <div className="device-events" key="device-events">
            {renderCommandBar()}
            {telemetrySchema && telemetrySchema.length === 0 ?
                <Label className="no-pnp-content">{t(ResourceKeys.deviceEvents.noEvent, {componentName})}</Label> :
                <>
                    <TextField
                        className={'consumer-group-text-field'}
                        onRenderLabel={renderConsumerGroupLabel()}
                        label={t(ResourceKeys.deviceEvents.consumerGroups.label)}
                        ariaLabel={t(ResourceKeys.deviceEvents.consumerGroups.label)}
                        underlined={true}
                        value={consumerGroup}
                        disabled={monitoringData}
                        onChange={consumerGroupChange}
                    />
                    {renderTelemetryViewChoiceGroup()}
                    {renderInfiniteScroll()}
                    {
                        showVisualization &&
                        <>
                            <Dropdown
                                className="data-to-visualize-dropdown"
                                label={t(ResourceKeys.deviceEvents.dataToVisualizeDropdownLabel)}
                                options={generateDropdownOptions()}
                                onChange={dataToVisualizeChange}
                            />
                            {renderChart()}
                        </>
                    }
                </>
            }
            {loadingAnnounced}
        </div>
    );
};
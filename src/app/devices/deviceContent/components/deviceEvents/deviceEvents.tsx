/***********************************************************
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License
 **********************************************************/
import * as React from 'react';
import moment from 'moment';
import { CommandBar, ICommandBarItemProps } from 'office-ui-fabric-react/lib/CommandBar';
import { Spinner } from 'office-ui-fabric-react/lib/Spinner';
import { TextField, ITextFieldProps } from 'office-ui-fabric-react/lib/TextField';
import { Announced } from 'office-ui-fabric-react/lib/Announced';
import { Toggle } from 'office-ui-fabric-react/lib/Toggle';
import { Dropdown, IDropdownOption } from 'office-ui-fabric-react/lib/Dropdown';
import { RouteComponentProps } from 'react-router-dom';
import { defaults, Line } from 'react-chartjs-2';
import { LocalizationContextConsumer, LocalizationContextInterface } from '../../../../shared/contexts/localizationContext';
import { ResourceKeys } from '../../../../../localization/resourceKeys';
import { monitorEvents, stopMonitoringEvents } from '../../../../api/services/devicesService';
import { Message } from '../../../../api/models/messages';
import { parseDateTimeString } from '../../../../api/dataTransforms/transformHelper';
import { CLEAR, CHECKED_CHECKBOX, EMPTY_CHECKBOX, START, STOP } from '../../../../constants/iconNames';
import { getDeviceIdFromQueryString } from '../../../../shared/utils/queryStringHelper';
import { SynchronizationStatus } from '../../../../api/models/synchronizationStatus';
import { MonitorEventsParameters } from '../../../../api/parameters/deviceParameters';
import { Notification, NotificationType } from '../../../../api/models/notification';
import LabelWithTooltip from '../../../../shared/components/labelWithTooltip';
import { DEFAULT_CONSUMER_GROUP } from '../../../../constants/apiConstants';
import { MILLISECONDS_IN_MINUTE } from '../../../../constants/shared';
import { appConfig, HostMode } from '../../../../../appConfig/appConfig';
import { HeaderView } from '../../../../shared/components/headerView';
import { isValidEventHubConnectionString } from '../../../../shared/utils/hubConnectionStringHelper';
import '../../../../css/_deviceEvents.scss';

const JSON_SPACES = 2;
const LOADING_LOCK = 50;
const MAX_CHART_POINTS = 50;

export interface DeviceEventsDataProps {
    connectionString: string;
}

export interface DeviceEventsActionProps {
    addNotification: (notification: Notification) => void;
}

export interface DeviceEventsState extends ConfigurationSettings{
    events: Message[];
    hasMore: boolean;
    startTime: Date;
    showSystemProperties: boolean;
    synchronizationStatus: SynchronizationStatus;
    monitoringData: boolean;

    loading?: boolean;
    loadingAnnounced?: JSX.Element;
}

export interface ConfigurationSettings {
    consumerGroup: string;
    useBuiltInEventHub: boolean;
    customEventHubName?: string;
    customEventHubConnectionString?: string;
    enableVisualization: boolean;
    dataToVisualize?: string;
}

export default class DeviceEventsComponent extends React.Component<DeviceEventsDataProps & DeviceEventsActionProps & RouteComponentProps, DeviceEventsState> {
    // tslint:disable-next-line:no-any
    private timerID: any;
    private isComponentMounted: boolean;
    constructor(props: DeviceEventsDataProps & DeviceEventsActionProps & RouteComponentProps) {
        super(props);

        this.state = {
            consumerGroup: DEFAULT_CONSUMER_GROUP,
            enableVisualization: false,
            events: [],
            hasMore: false,
            monitoringData: false,
            showSystemProperties: false,
            startTime: new Date(new Date().getTime() - MILLISECONDS_IN_MINUTE), // set start time to one minute ago
            synchronizationStatus: SynchronizationStatus.initialized,
            useBuiltInEventHub: true,
        };
    }

    public componentWillUnmount() {
        this.stopMonitoring();
        this.isComponentMounted = false;
    }

    public render(): JSX.Element {
        return (
            <LocalizationContextConsumer>
                {(context: LocalizationContextInterface) => (
                    <div className="device-events" key="device-events">
                        <CommandBar
                            className="command"
                            items={this.createCommandBarItems(context)}
                        />
                        <HeaderView
                            headerText={ResourceKeys.deviceEvents.headerText}
                            tooltip={ResourceKeys.deviceEvents.tooltip}
                        />
                        {this.renderConsumerGroup(context)}
                        {this.renderCustomEventHub(context)}
                        {this.renderEventView(context)}
                        {this.state.loadingAnnounced}
                    </div>
                )}
            </LocalizationContextConsumer>
        );
    }

    private createCommandBarItems = (context: LocalizationContextInterface): ICommandBarItemProps[] => {
        return [
            this.createStartMonitoringCommandItem(context),
            this.createClearCommandItem(context),
            this.createSystemPropertiesCommandItem(context)
        ];
    }

    private createClearCommandItem = (context: LocalizationContextInterface): ICommandBarItemProps => {
        return {
            ariaLabel: context.t(ResourceKeys.deviceEvents.command.clearEvents),
            disabled: this.state.events.length === 0 || this.state.synchronizationStatus === SynchronizationStatus.updating,
            iconProps: {
                iconName: CLEAR
            },
            key: CLEAR,
            name: context.t(ResourceKeys.deviceEvents.command.clearEvents),
            onClick: this.onClearData
        };
    }

    private createSystemPropertiesCommandItem = (context: LocalizationContextInterface): ICommandBarItemProps => {
        return {
            ariaLabel: context.t(ResourceKeys.deviceEvents.command.showSystemProperties),
            disabled: this.state.synchronizationStatus === SynchronizationStatus.updating,
            iconProps: {
                iconName: this.state.showSystemProperties ? CHECKED_CHECKBOX : EMPTY_CHECKBOX
            },
            key: CHECKED_CHECKBOX,
            name: context.t(ResourceKeys.deviceEvents.command.showSystemProperties),
            onClick: this.onShowSystemProperties
        };
    }

    private createStartMonitoringCommandItem = (context: LocalizationContextInterface): ICommandBarItemProps => {
        if (appConfig.hostMode === HostMode.Electron) {
            const label = this.state.monitoringData ? context.t(ResourceKeys.deviceEvents.command.stop) : context.t(ResourceKeys.deviceEvents.command.start);
            const icon = this.state.monitoringData ? STOP : START;
            return {
                ariaLabel: label,
                disabled: this.state.synchronizationStatus === SynchronizationStatus.updating,
                iconProps: {
                    iconName: icon
                },
                key: icon,
                name: label,
                onClick: this.onToggleStart
            };
        }
        else {
            return {
                ariaLabel: context.t(ResourceKeys.deviceEvents.command.fetch),
                disabled: this.state.synchronizationStatus === SynchronizationStatus.updating || this.state.monitoringData,
                iconProps: {
                    iconName: START
                },
                key: START,
                name: context.t(ResourceKeys.deviceEvents.command.fetch),
                onClick: this.onToggleStart
            };
        }
    }

    private renderConsumerGroup = (context: LocalizationContextInterface) => {
        const renderConsumerGroupLabel = (props: ITextFieldProps) => (
            <LabelWithTooltip
                className={'consumer-group-label'}
                tooltipText={context.t(ResourceKeys.deviceEvents.consumerGroups.tooltip)}
            >
                {props.label}
            </LabelWithTooltip>
        );

        const consumerGroupChange = (event: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>, newValue?: string) => {
            this.setState({
                consumerGroup: newValue
            });
        };

        return (
            <TextField
                className={'consumer-group-text-field'}
                onRenderLabel={renderConsumerGroupLabel}
                label={context.t(ResourceKeys.deviceEvents.consumerGroups.label)}
                ariaLabel={context.t(ResourceKeys.deviceEvents.consumerGroups.label)}
                underlined={true}
                value={this.state.consumerGroup}
                disabled={this.state.monitoringData}
                onChange={consumerGroupChange}
            />
        );
    }

    private renderCustomEventHub = (context: LocalizationContextInterface) => {
        const toggleChange = () => {
            this.setState({
                useBuiltInEventHub: !this.state.useBuiltInEventHub
            });
        };

        const customEventHubConnectionStringChange = (event: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>, newValue?: string) => {
            this.setState({
                customEventHubConnectionString: newValue
            });
        };

        const renderError = () => {
            return !isValidEventHubConnectionString(this.state.customEventHubConnectionString) && context.t(ResourceKeys.deviceEvents.customEventHub.connectionString.error);
        };

        const customEventHubNameChange = (event: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>, newValue?: string) => {
            this.setState({
                customEventHubName: newValue
            });
        };

        return (
            <>
                <Toggle
                    className="toggle-button"
                    checked={this.state.useBuiltInEventHub}
                    ariaLabel={context.t(ResourceKeys.deviceEvents.toggleUseDefaultEventHub.label)}
                    label={context.t(ResourceKeys.deviceEvents.toggleUseDefaultEventHub.label)}
                    onText={context.t(ResourceKeys.deviceEvents.toggleUseDefaultEventHub.on)}
                    offText={context.t(ResourceKeys.deviceEvents.toggleUseDefaultEventHub.off)}
                    onChange={toggleChange}
                    disabled={this.state.monitoringData}
                />
                {!this.state.useBuiltInEventHub &&
                    <>
                        <TextField
                            className={'custom-event-hub-text-field'}
                            label={context.t(ResourceKeys.deviceEvents.customEventHub.connectionString.label)}
                            ariaLabel={context.t(ResourceKeys.deviceEvents.customEventHub.connectionString.label)}
                            underlined={true}
                            value={this.state.customEventHubConnectionString}
                            disabled={this.state.monitoringData}
                            onChange={customEventHubConnectionStringChange}
                            placeholder={context.t(ResourceKeys.deviceEvents.customEventHub.connectionString.placeHolder)}
                            errorMessage={renderError()}
                            required={true}
                        />
                        <TextField
                            className={'custom-event-hub-text-field'}
                            label={context.t(ResourceKeys.deviceEvents.customEventHub.name.label)}
                            ariaLabel={context.t(ResourceKeys.deviceEvents.customEventHub.name.label)}
                            underlined={true}
                            value={this.state.customEventHubName}
                            disabled={this.state.monitoringData}
                            onChange={customEventHubNameChange}
                            required={true}
                        />
                    </>
                }
            </>
        );
    }

    private stopMonitoring = () => {
        clearTimeout(this.timerID);
        return stopMonitoringEvents();
    }

    private onToggleStart = () => {
        const monitoringState = this.state.monitoringData;

        if (monitoringState) {
            this.stopMonitoring().then(() => {
                this.setState({
                    monitoringData: false,
                    synchronizationStatus: SynchronizationStatus.fetched
                });
            });
            this.setState({
                hasMore: false,
                synchronizationStatus: SynchronizationStatus.updating
            });
        } else {
            this.setState({
                hasMore: true,
                loading: false,
                loadingAnnounced: undefined,
                monitoringData: true
            });
        }
    }

    public componentDidMount() {
        this.isComponentMounted = true;
    }

    private readonly renderEventView = (context: LocalizationContextInterface) => {
        const toggleChange = () => {
            this.setState({
                enableVisualization: !this.state.enableVisualization
            });
        };

        const dataToVisualizeChange = (event: React.FormEvent<HTMLDivElement>, option?: IDropdownOption) => {
            this.setState({
                dataToVisualize: option.text
            });
        };

        const generateDropdownOptions = () => {
            const { events } = this.state;
            return(
                Array.from(
                    events.reduce(
                        (properties: Set<string>, event: Message) => {
                            if (event.properties !== undefined) {
                                for (const property of Object.keys(event.properties)) {
                                    properties.add(property);
                                }
                            }
                            return properties;
                        },
                        new Set<string>()
                    )
                ).map(
                    (property: string) => {
                        return({
                            key: property,
                            text: property
                        });
                    }
                )
            );
        };

        return(
            <>
                <Toggle
                    className="toggle-button"
                    checked={this.state.enableVisualization}
                    ariaLabel={context.t(ResourceKeys.deviceEvents.toggleEnableVisualization.label)}
                    label={context.t(ResourceKeys.deviceEvents.toggleEnableVisualization.label)}
                    onText={context.t(ResourceKeys.deviceEvents.toggleEnableVisualization.on)}
                    offText={context.t(ResourceKeys.deviceEvents.toggleEnableVisualization.off)}
                    onChange={toggleChange}
                />
                {this.renderInfiniteScroll(context)}
                {
                    this.state.enableVisualization &&
                    <>
                        <Dropdown
                            className="data-to-visualize-dropdown"
                            label={context.t(ResourceKeys.deviceEvents.visualization.label)}
                            defaultSelectedKey={this.state.dataToVisualize}
                            options={generateDropdownOptions()}
                            onChange={dataToVisualizeChange}
                        />
                        {this.renderChart(context)}
                    </>
                }
            </>
        );

    }

    private readonly renderChart = (context: LocalizationContextInterface) => {
        const { events } = this.state;
        const data = events.reduce(
            (points, event: Message) => {
                if (event.properties !== undefined && event.properties.hasOwnProperty(this.state.dataToVisualize) && points.labels.length < MAX_CHART_POINTS) {
                    points.datasets[0].data.push(Number(event.properties[this.state.dataToVisualize]));
                    points.labels.push(moment(event.enqueuedTime).toDate());
                }
                return points;
            },
            {
                datasets: [{
                    backgroundColor: 'rgba(0, 116, 204, 1)',
                    data: [],
                    fill: false,
                    label: this.state.dataToVisualize,
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
    }

    private readonly renderInfiniteScroll = (context: LocalizationContextInterface) => {
        const { hasMore } = this.state;
        const InfiniteScroll = require('react-infinite-scroller'); // https://github.com/CassetteRocks/react-infinite-scroller/issues/110
        return (
            <InfiniteScroll
                key="scroll"
                className="device-events-container"
                pageStart={0}
                loadMore={this.fetchData(context)}
                hasMore={hasMore}
                loader={this.renderLoader(context)}
                role={this.state.events && this.state.events.length === 0 ? 'main' : 'feed'}
                isReverse={true}
            >
            {!this.state.enableVisualization && this.renderEvents()}
            </InfiniteScroll>
        );
    }

    private readonly renderEvents = () => {
        const { events } = this.state;

        return (
            <div className="scrollable-telemetry">
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
    }

    private readonly renderLoader = (context: LocalizationContextInterface): JSX.Element => {
        return (
            <div key="loading" className="events-loader">
                <Spinner/>
                <h4>{context.t(ResourceKeys.deviceEvents.infiniteScroll.loading)}</h4>
            </div>
        );
    }

    private readonly fetchData = (context: LocalizationContextInterface) => () => {
        const { loading, monitoringData } = this.state;
        if (!loading && monitoringData) {
            this.setState({
                loading: true,
                loadingAnnounced: <Announced message={context.t(ResourceKeys.deviceEvents.infiniteScroll.loading)}/>
            });
            this.timerID = setTimeout(
                () => {
                    let parameters: MonitorEventsParameters = {
                        consumerGroup: this.state.consumerGroup,
                        deviceId: getDeviceIdFromQueryString(this.props),
                        fetchSystemProperties: this.state.showSystemProperties,
                        startTime: this.state.startTime
                    };

                    if (!this.state.useBuiltInEventHub && this.state.customEventHubConnectionString && this.state.customEventHubName) {
                        parameters = {
                            ...parameters,
                            customEventHubConnectionString: this.state.customEventHubConnectionString,
                            customEventHubName: this.state.customEventHubName
                        };
                    }
                    else {
                        parameters = {
                            ...parameters,
                            hubConnectionString: this.props.connectionString,
                        };
                    }

                    monitorEvents(parameters)
                    .then(results => {
                        const messages = results ? results.reverse().map((message: Message) => message) : [];
                        if (this.isComponentMounted) {
                            this.setState({
                                events: [...messages, ...this.state.events],
                                loading: false,
                                startTime: new Date()
                            });
                            this.stopMonitoringIfNecessary();
                        }
                    })
                    .catch (error => {
                        this.props.addNotification({
                            text: {
                                translationKey: ResourceKeys.deviceEvents.error,
                                translationOptions: {
                                    error
                                }
                            },
                            type: NotificationType.error
                        });
                        this.stopMonitoringIfNecessary();
                    });
                },
                LOADING_LOCK);
        }
    }

    private readonly onClearData = () => {
        this.setState({
            events: []
        });
    }

    private readonly onShowSystemProperties = () => {
        this.setState({
            showSystemProperties: !this.state.showSystemProperties
        });
    }

    private readonly stopMonitoringIfNecessary = () => {
        if (appConfig.hostMode === HostMode.Electron) {
            return;
        }
        else {
            this.stopMonitoring().then(() => {
                this.setState({
                    hasMore: false,
                    monitoringData: false,
                    synchronizationStatus: SynchronizationStatus.fetched
                });
            });
        }
    }
}

/***********************************************************
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License
 **********************************************************/
import * as React from 'react';
import * as ReactDOM from 'react-dom';

const ViewHolder =  () => <p>welcome to new IoT explorer</p>;

ReactDOM.render(
    <ViewHolder />,
    document.getElementById('device-explorer'),
);

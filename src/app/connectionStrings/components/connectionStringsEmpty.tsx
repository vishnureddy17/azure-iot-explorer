/***********************************************************
* Copyright (c) Microsoft Corporation. All rights reserved.
* Licensed under the MIT License
**********************************************************/
import * as React from 'react';
import { Link } from 'office-ui-fabric-react/lib/components/Link';
import { NavLink } from 'react-router-dom';
import { ResourceKeys } from '../../../localization/resourceKeys';
import { useLocalizationContext } from '../../shared/contexts/localizationContext';
import './connectionStringsEmpty.scss';

export const ConnectionStringsEmpty: React.FC = props => {
    const { t } = useLocalizationContext();

    return (
        <div className="connection-strings-empty">
            <h3 role="heading" aria-level={1}>{t(ResourceKeys.connectionStrings.empty.header)}</h3>
            <div>
                <span>{t(ResourceKeys.connectionStrings.empty.description)}</span>
                <NavLink to="/" className="embedded-link">Home.</NavLink>
            </div>

            <h3 role="heading" aria-level={1}>{t(ResourceKeys.settings.questions.headerText)}</h3>
            <Link
                href={t(ResourceKeys.connectivityPane.connectionStringComboBox.link)}
                target="_blank"
            >
                {t(ResourceKeys.connectivityPane.connectionStringComboBox.linkText)}
            </Link>
        </div>
    );
};

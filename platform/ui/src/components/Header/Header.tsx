import React from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';

import NavBar from '../NavBar';
import Svg from '../Svg';
import Icon from '../Icon';
import IconButton from '../IconButton';
import Dropdown from '../Dropdown';

// Import the mic.svg as a React component
import { ReactComponent as MicIcon } from './mic.svg';  // Adjust the path if necessary

interface HeaderProps {
    children: React.ReactNode;
    menuOptions: any;
    isReturnEnabled: boolean;
    onClickReturnButton: () => void;
    isSticky: boolean;
    WhiteLabeling: any;
    onVoiceCommandClick: () => void;  // Add this prop to trigger voice command
}

function Header({
                    children,
                    menuOptions,
                    isReturnEnabled,
                    onClickReturnButton,
                    isSticky,
                    WhiteLabeling,
                    onVoiceCommandClick,  // Destructure the voice command click handler
                    ...props
                }: HeaderProps): React.ReactNode {
    const { t } = useTranslation('Header');

    const onClickReturn = () => {
        if (isReturnEnabled && onClickReturnButton) {
            onClickReturnButton();
        }
    };

    return (
        <NavBar
            className="justify-between border-b-4 border-black"
            isSticky={isSticky}
        >
            <div className="flex justify-between flex-1">
                <div className="flex items-center">
                    <div
                        className={classNames(
                            'inline-flex items-center mr-3',
                            isReturnEnabled && 'cursor-pointer'
                        )}
                        onClick={onClickReturn}
                    >
                        {isReturnEnabled && (
                            <Icon name="chevron-left" className="w-8 text-primary-active" />
                        )}
                        <div className="ml-4">
                            {WhiteLabeling?.createLogoComponentFn?.(React, props) || (
                                <Svg name="logo-ohif" />
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex items-center">{children}</div>
                <div className="flex items-center">
                    {/* Removed "INVESTIGATIONAL USE ONLY" text */}

                    {/* Voice Command Button */}
                    <IconButton
                        variant="text"
                        color="inherit"
                        className="text-primary-active"
                        onClick={onVoiceCommandClick} // Trigger the voice command function
                    >
                        <React.Fragment>
                            {/* Use the imported MicIcon SVG */}
                            <MicIcon className="w-6 h-6" /> {/* Adjust the size of the icon */}
                        </React.Fragment>
                    </IconButton>

                    {/* Settings Button with Dropdown */}
                    <Dropdown id="options" showDropdownIcon={false} list={menuOptions}>
                        <IconButton
                            id={'options-settings-icon'}
                            variant="text"
                            color="inherit"
                            size="initial"
                            className="text-primary-active"
                        >
                            <Icon name="settings" />
                        </IconButton>
                        <IconButton
                            id={'options-chevron-down-icon'}
                            variant="text"
                            color="inherit"
                            size="initial"
                            className="text-primary-active"
                        >
                            <Icon name="chevron-down" />
                        </IconButton>
                    </Dropdown>
                </div>
            </div>
        </NavBar>
    );
}

Header.propTypes = {
    menuOptions: PropTypes.arrayOf(
        PropTypes.shape({
            title: PropTypes.string.isRequired,
            icon: PropTypes.string,
            onClick: PropTypes.func.isRequired,
        })
    ),
    children: PropTypes.oneOfType([PropTypes.node, PropTypes.func]),
    isReturnEnabled: PropTypes.bool,
    isSticky: PropTypes.bool,
    onClickReturnButton: PropTypes.func,
    WhiteLabeling: PropTypes.object,
    onVoiceCommandClick: PropTypes.func.isRequired, // Add this to propTypes
};

Header.defaultProps = {
    isReturnEnabled: true,
    isSticky: false,
};

export default Header;

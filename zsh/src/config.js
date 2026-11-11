export const APT_PACKAGES = ['git', 'curl', 'zsh', 'bat'];
export const OPTIONAL_APT_PACKAGES = ['eza'];

export const OMZ_INSTALL_URL = 'https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh';

export const CUSTOM_REPOS = [
    { kind: 'plugins', name: 'zsh-autosuggestions', url: 'https://github.com/zsh-users/zsh-autosuggestions' },
    { kind: 'plugins', name: 'zsh-syntax-highlighting', url: 'https://github.com/zsh-users/zsh-syntax-highlighting' },
    { kind: 'themes', name: 'spaceship-prompt', url: 'https://github.com/spaceship-prompt/spaceship-prompt' },
];

export const THEME_ENTRY = 'spaceship.zsh-theme';

/** Glifos Nerd Font usados pelo tema (git e node), seguidos de um espaco. */
export const SYMBOLS = {
    '@GIT_SYMBOL@': '\uf418 ',
    '@NODE_SYMBOL@': '\ue718 ',
};

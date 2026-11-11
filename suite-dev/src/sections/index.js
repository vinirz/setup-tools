import { ambienteSection } from './ambiente.js';
import { dockerSection } from './docker.js';
import { extrasSection } from './extras.js';
import { gitSection } from './git.js';
import { nodeSection } from './node.js';
import { pacotesSection } from './pacotes.js';
import { posSection } from './pos.js';
import { repoSection } from './repo.js';
import { setupSection } from './setup.js';
import { sshSection } from './ssh.js';

/** Ordem do fluxo: ambiente -> pacotes -> git -> ssh -> docker -> node -> extras -> repo -> setup -> verificacao. */
export const SECTIONS = [
    ambienteSection, pacotesSection, gitSection, sshSection, dockerSection,
    nodeSection, extrasSection, repoSection, setupSection, posSection,
];

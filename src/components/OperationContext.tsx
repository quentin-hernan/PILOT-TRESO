import { createContext } from 'react';
import type { Operation } from '../types';

/** Quand il est fourni, toucher une opération dans une liste l'ouvre pour la modifier. */
export const OperationSelectContext = createContext<((op: Operation) => void) | null>(null);

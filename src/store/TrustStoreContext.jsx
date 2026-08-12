import { createContext, useContext, useReducer } from 'react';
import { trustReducer, initialState } from './trustReducer.js';

const TrustStoreContext = createContext(null);

export function TrustStoreProvider({ children }) {
  const [state, dispatch] = useReducer(trustReducer, initialState);
  return <TrustStoreContext.Provider value={{ state, dispatch }}>{children}</TrustStoreContext.Provider>;
}

export function useTrustStore() {
  const ctx = useContext(TrustStoreContext);
  if (!ctx) throw new Error('useTrustStore must be used within a TrustStoreProvider');
  return ctx;
}

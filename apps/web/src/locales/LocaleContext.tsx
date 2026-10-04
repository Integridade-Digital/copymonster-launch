import React, { createContext, useContext, useState, useEffect } from 'react';
import { LocaleId, TranslationKey, getActiveLocale, setActiveLocale, t } from './index';

interface LocaleContextValue {
  locale: LocaleId;
  setLocale: (locale: LocaleId) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'en',
  setLocale: () => {},
  t,
});

export const LocaleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<LocaleId>(() => getActiveLocale());

  const handleSetLocale = (newLocale: LocaleId) => {
    setActiveLocale(newLocale);
    setLocaleState(newLocale);
  };

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'dsh_locale' || e.key === 'locale') {
        setLocaleState(getActiveLocale());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return (
    <LocaleContext.Provider value={{ locale, setLocale: handleSetLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
};

export const useLocale = () => useContext(LocaleContext);
export const useT = () => {
  const { t } = useContext(LocaleContext);
  return t;
};

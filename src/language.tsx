import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { I18n } from 'aws-amplify/utils';
import { translations } from '@aws-amplify/ui-react';
import { formatDate, persistLanguage, readLanguage, translate, type Language, type TranslationKey } from './i18n';

I18n.putVocabularies(translations);
I18n.setLanguage(readLanguage());

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey) => string;
  fmtDate: (date: string) => string;
};
const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, updateLanguage] = useState(readLanguage);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = translate(language, 'title');
  }, [language]);
  const setLanguage = (next: Language) => {
    I18n.setLanguage(next);
    persistLanguage(next);
    updateLanguage(next);
  };
  return <LanguageContext.Provider value={{ language, setLanguage,
    t: key => translate(language, key), fmtDate: date => formatDate(date, language) }}>
    {children}
  </LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('LanguageProvider is required');
  return value;
}

export function LanguageSelector() {
  const { language, setLanguage, t } = useLanguage();
  return <div className="languageBar"><label className="languageControl">
    <span>{t('language')}</span>
    <select value={language} onChange={event => setLanguage(event.target.value as Language)}>
      <option value="en" lang="en">English</option>
      <option value="es" lang="es">Español</option>
    </select>
  </label></div>;
}

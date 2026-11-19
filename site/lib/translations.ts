// 界面文字用官方简体中文语言包，再补几条本站措辞。
import { zhCN } from '@fumadocs/language/zh-cn';
import { defineTranslations } from 'fumadocs-core/i18n';
import { uiTranslations } from 'fumadocs-ui/i18n';

export const translations = defineTranslations()
  .extend(uiTranslations())
  .preset(zhCN())
  .add({ 'Search(search trigger)': '搜索文档' });

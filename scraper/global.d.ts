import 'puppeteer';

declare module 'puppeteer' {
  interface Page {
    $x(expression: string): Promise<import('puppeteer').ElementHandle[]>;
  }
}

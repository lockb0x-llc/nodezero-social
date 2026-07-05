declare module 'react-native-rss-parser' {
  export interface RssItemLink {
    url?: string
  }

  export interface RssItem {
    title?: string
    description?: string
    content?: string
    creator?: string
    published?: string
    pubDate?: string
    isoDate?: string
    link?: string
    links?: RssItemLink[]
  }

  export interface RssFeed {
    title?: string
    description?: string
    items?: RssItem[]
  }

  export function parse(xml: string): Promise<RssFeed>
}

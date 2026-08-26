// pages/media/MediaOverview.jsx —— 自媒体工作台主页（路由 /media）
// 内容块抽到 MediaOverviewContent，Dashboard 顶部也共用同一份（保持两处一致）
import React from 'react';
import MediaOverviewContent from './MediaOverviewContent.jsx';

export default function MediaOverview() {
  return (
    <div style={{ maxWidth: 1050 }}>
      <MediaOverviewContent />
    </div>
  );
}

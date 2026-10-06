import type { MetaItem } from './metadata';

const AGE='h = giờ · d = ngày · w = tuần · mo = tháng · y = năm. Hiển thị số đơn vị đã tròn; tháng và năm tính theo lịch.';
export type MetadataExplanation={title:string;value:string;lines:string[]};
export function explainMetadata(m:MetaItem):MetadataExplanation {
  const lines:string[]=[];
  if(m.detail && m.detail!==m.text)lines.push('Giá trị đầy đủ: '+m.detail);
  switch(m.title) {
    case 'Năm phát hành':
      lines.push('Màu theo năm phát hành: từ 2024 xanh lá; 2020–2023 xám; 2010–2019 xanh nhạt; 2000–2009 xanh sage; 1980–1999 vàng nhạt; trước 1980 tím.');break;
    case 'Thêm vào thư viện':
      lines.push('Dấu + là thời gian từ ngày thêm vào thư viện đến hiện tại.',AGE,'Màu theo tuổi trong thư viện: dưới 1 tháng xanh lá; từ 1 đến dưới 3 tháng xanh ngọc; từ 3 tháng đến dưới 1 năm xám; từ 1 đến dưới 2 năm xanh nhạt; từ 2 đến dưới 3 năm xanh sage; từ 3 đến dưới 5 năm vàng nhạt; từ 5 năm tím.');break;
    case 'Lần nghe cuối':
      lines.push('Dấu ▷ là thời gian từ lần nghe cuối được ghi nhận đến hiện tại, không giới hạn trong kỳ đang xem.',AGE,'Dưới 12 giờ xanh lá; từ 12 đến dưới 24 giờ xanh sage; từ 1 ngày đến dưới 3 tháng xám; từ 3 đến dưới 6 tháng vàng; từ 6 tháng đến dưới 1 năm đỏ; từ 1 năm tím.');break;
    case 'Độ dài bài hát':
      lines.push('Độ dài một lần phát bài hát, theo phút:giây.');
      if(m.rule)lines.push(...m.rule);
      break;
    case 'Đánh giá của bạn':
      lines.push('Màu tên bài theo đánh giá trong thư viện: 5 sao vàng nhạt; 4 sao xanh sage; 3 sao xanh nhạt; dưới 3 sao hoặc chưa đánh giá màu xám.');break;
    case 'Màu nghệ sĩ':
      lines.push('Theo tổng giờ nghe All time: dưới 72 giờ xám; từ 72 đến dưới 120 giờ xanh nhạt; từ 120 đến dưới 168 giờ xanh sage; từ 168 đến dưới 240 giờ vàng nhạt; từ 240 giờ tím.');break;
    default:lines.push(m.title);
  }
  return {title:m.title,value:m.text,lines};
}

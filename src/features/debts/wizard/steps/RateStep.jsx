import RateField from '../../RateField';
import Notices from '../Notices';

export default function RateStep({ rate, echo, onChange }) {
  return (
    <div className="flex flex-col gap-4">
      <RateField rate={rate} echo={echo} onChange={onChange} />
      {echo.ok && echo.notice && <Notices notices={[echo.notice]} />}
    </div>
  );
}

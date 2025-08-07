import { RiTimeLine } from "react-icons/ri";
import { SlLocationPin } from "react-icons/sl";

export default function IconWrapper({ type, className }) {
  if (type === "time") return <RiTimeLine className={className} />;
  if (type === "location") return <SlLocationPin className={className} />;
  return null;
}

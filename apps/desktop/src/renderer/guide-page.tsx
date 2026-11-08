import { GuideSteps } from "@/app/guide/steps";
import guideStyles from "@/app/guide/guide.module.css";

export function GuidePage() {
  return (
    <div className={guideStyles.page} style={{ margin: 0, padding: 0 }}>
      <h1 className={guideStyles.title}>How to film a good clip</h1>
      <p className={guideStyles.lead}>Five things make the biggest difference. Show this to whoever films from the launch.</p>
      <GuideSteps />
      <a className="button primary" href="#/add">Add a video</a>
    </div>
  );
}

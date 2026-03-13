import { StorefrontLayout } from "@/components/StorefrontLayout";
import { Bell, Heart, Users, Percent } from "lucide-react";
import { usePageSeo } from "@/hooks/use-page-seo";

export default function BlueBellClubPage() {
  usePageSeo({
    title: "Blue Bell LEGO Club | Kuso Oishii",
    description:
    "Join the Blue Bell LEGO Club and enjoy 5% off every order, with a matching 5% donated to the club. Supporting your local LEGO community.",
    path: "/blue-bell-club"
  });

  return (
    <StorefrontLayout>
      {/* Hero */}
      <section className="border-b border-border bg-background py-16 lg:py-24">
        <div className="container max-w-3xl text-center">
          <Bell className="mx-auto h-10 w-10 text-blue-500" />
          <h1 className="mt-6 font-display text-3xl font-bold text-foreground lg:text-5xl">
            Blue Bell LEGO Club
          </h1>
          <p className="mt-4 font-body text-base leading-relaxed text-muted-foreground lg:text-lg">
            We're the proud sponsor of LEGO Club nights at The Blue Bell, Stoke Ferry — where grown adults get together, sink a few pints, and build LEGO like they're eight years old again except now they're allowed to swear when they step on a brick.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-muted/30 py-16 lg:py-24">
        <div className="container max-w-4xl">
          <h2 className="font-display text-2xl font-bold text-foreground lg:text-3xl">
            How it works
          </h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-3">
            {[{
              icon: Users,
              title: "Join the Club",
              desc: "Become a member of Blue Bell LEGO Club through your local group."
            },
            {
              icon: Percent,
              title: "Save 5%",
              desc: "Every order you place with us is automatically discounted at checkout."
            },
            {
              icon: Heart,
              title: "Give 5%",
              desc: "We donate a matching 5% of your order value directly to Blue Bell."
            }].
            map(({ icon: Icon, title, desc }) =>
            <div key={title} className="flex flex-col items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-500/10">
                  <Icon className="h-5 w-5 text-blue-500" />
                </div>
                <h3 className="font-display text-sm font-semibold text-foreground">{title}</h3>
                <p className="font-body text-sm leading-relaxed text-muted-foreground">{desc}</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Details */}
      <section className="border-t border-border bg-background py-16 lg:py-24">
        <div className="container max-w-3xl space-y-6">
          <h2 className="font-display text-2xl font-bold text-foreground lg:text-3xl">
            About the partnership
          </h2>
          <div className="space-y-4 font-body text-sm leading-relaxed text-muted-foreground">
            <p>
              Blue Bell LEGO Club is a community of adult LEGO enthusiasts who meet regularly to build, trade, and talk bricks. We're proud to support them through a simple deal: every member who shops with Kuso Oishii saves 5%, and we donate a matching 5% to keep the club running.
            </p>
            <p>
              No codes. No hoops. Link your club membership to your account and the discount applies automatically at checkout. The donation is calculated on the same order total and paid directly to Blue Bell at the end of each month.
            </p>
            <p>
              If you're already a member of the club, log in and link your membership in your account settings. If you're not a member yet, get in touch with Blue Bell to join — then come back and start saving.
            </p>
          </div>
        </div>
      </section>
    </StorefrontLayout>);

}
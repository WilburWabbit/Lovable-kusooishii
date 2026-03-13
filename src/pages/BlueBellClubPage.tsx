import { StorefrontLayout } from "@/components/StorefrontLayout";
import { Bell, Heart, Users, Percent } from "lucide-react";
import { usePageSeo } from "@/hooks/use-page-seo";

export default function BlueBellClubPage() {
  usePageSeo({
    title: "Blue Bell LEGO Club | Kuso Oishii",
    description:
    "Join the Blue Bell LEGO Club and enjoy 5% off every order, with a matching 5% donated to the club. Supporting your local LEGO community.",
    path: "/bluebell"
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
          <p className="mt-4 font-body text-base leading-relaxed text-muted-foreground lg:text-lg">A partnership built on bricks and beer
You save 5% 
The Blue Bell gets 5%

          </p>
        </div>
      </section>

      {/* Copy */}
      <section className="bg-muted/30 py-16 lg:py-24">
        <div className="container max-w-3xl space-y-8 text-2xl">
          <div className="space-y-4 font-body text-sm leading-relaxed text-muted-foreground">
            <p className="font-display text-lg font-bold text-foreground lg:text-xl">
              Bricks. Beer. Absolute chaos.
            </p>
            <p>We're the proud sponsor of LEGO Club at The Blue Bell, Stoke Ferry — where supposed adults get together, sink a few pints, and build LEGO like they're eight years old again except now they're allowed to swear when they step on a brick.
              <a href="https://www.bluebellstokeferry.org" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline hover:text-blue-600">The Blue Bell, Stoke Ferry</a> — where grown adults get together, sink a few pints, and build LEGO like they're eight years old again except now they're allowed to swear when they step on a brick.
            </p>
            <p>This isn't a quiet  craft session. This is a pub full of people who know what kragle is, who think "just one more set" is a perfectly reasonable thing to say, right after "just one more pint." 

It's magnificent.
</p>
          </div>

          <div className="space-y-4 font-body text-sm leading-relaxed text-muted-foreground">
            <h2 className="font-display text-lg font-bold text-foreground lg:text-xl">The Deal</h2>
            <ol className="list-decimal list-inside space-y-2 font-body text-sm leading-relaxed text-muted-foreground">
              <li>Create a Kuso Oishii account</li>
              <li>Add a set to your basket</li>
              <li>Choose Blue Bell collection during checkout</li>
              <li>We'll knock 5% off — because you're one of us now.</li>
              <li>Pick your set up behind the bar on club night while you're getting a round in</li>
            </ol>
            <p>No couriers. No "sorry we missed you" cards. Just bricks and beer.</p>
          </div>

          <div className="space-y-4 font-body text-sm leading-relaxed text-muted-foreground">
            <h2 className="font-display text-lg font-bold text-foreground lg:text-xl">Even Better.</h2>
            <p>
              That discount we gave you? We'll donate a matching 5% direct to The Blue Bell too, because a community pub that lets a bunch of AFOLs get loud over LEGO deserves your money more than Amazon does.
            </p>
          </div>

          <div className="space-y-4 font-body text-sm leading-relaxed text-muted-foreground">
            <h2 className="font-display text-lg font-bold text-foreground lg:text-xl">How It Works</h2>
            <p>
              Get yourself an account. Browse our stock — returned, open-box, and damaged-box sets at prices that leave you with actual beer money. Pick Blue Bell LEGO Club delivery at checkout, your 5% comes off automatically, and your set turns up at the pub ready for you to crack open at the table like the beautiful disaster you are.
            </p>
            <p className="font-display text-sm font-semibold text-foreground">
              See you at the bar. First round's on you.
            </p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-border bg-background py-16 lg:py-24">
        <div className="container max-w-4xl">
          <h2 className="font-display text-2xl font-bold text-foreground lg:text-3xl">
            How it works
          </h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-3">
            {[{ icon: Users, title: "Join the Club", desc: "Become a member of Blue Bell LEGO Club through your local group." }, { icon: Percent, title: "Save 5%", desc: "Every order you place with us is automatically discounted at checkout."
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
    </StorefrontLayout>);

}
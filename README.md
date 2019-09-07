#browserify rewritten in typescript and replaced acorn with meriyah and using pack flat by default (basically a rollup iife)


#meriyah ast explorer (its 2x faster than acorn and typed)
https://meriyah.github.io/meriyah/


#thoughts
this is still a mess, i feel like i should be able to delete about 75% of the code.

the dev output is about 4x smaller than webpacks garbage, which helps a little with larger apps

react dev mode is pretty shit, i doubt it's even representative of runtime bottlenecks

you can comment out the tsify plugin in the dev build, its only purpose is code checks
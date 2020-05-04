#thoughts
this is still a mess, i feel like i should be able to delete about 75% of the code.

the dev output is about 4x smaller than webpacks garbage, which helps a little with larger apps

react dev mode is pretty shit, i doubt it's even representative of runtime bottlenecks
you can hmr with react production mode here, ty baby jesus

note: either the livereactload or sucrasify transform can load react-hot-loader.
  - the sucrasify transform decorates the code almost exactly the same as babel
  - the sucrasify transform will automatically require react-hot-loader if you use the "react-hot-loader" option
  - you can set up livereactload to require it also, but that makes it harder to have reload but NOT hot without having uneccessary code

#random size combos
react prod 413kb with hot loader
413 flat/prod
1355 packed/dev
1355 flat/dev
234 react prod
90 preact prod

